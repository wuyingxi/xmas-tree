"""Christmas tree backend (stdlib + Pillow): shared public tree + optional isolated rooms.

API
  GET    /api/rooms/<slug>         -> {"room": {slug, title, locked, authorized}}
  POST   /api/rooms                public JSON {slug?, title?, passcode?} -> 201 {"room": {...}}
  GET    /api/rooms                header X-Admin-Token -> {"rooms": [...]}
  DELETE /api/rooms/<slug>         header X-Admin-Token -> 200 {"ok": true}

  GET    /api/photos[?tree=<slug>] -> {"photos": [{id, url, w, h}]}
  POST   /api/photos[?tree=<slug>] public raw image body (+ X-Room-Passcode if locked) -> 201 {"photo": {...}}
  DELETE /api/photos/<id>[?tree=<slug>] header X-Admin-Token

  GET    /api/wishes[?tree=<slug>] -> {"wishes": [{id, text, author, theme, t}]}
  POST   /api/wishes[?tree=<slug>] public JSON {text, author?, theme?} (+ X-Room-Passcode if locked) -> 201 {"wish": {...}}
  DELETE /api/wishes/<id>[?tree=<slug>] header X-Admin-Token

  GET    /api/auth                 header X-Admin-Token -> 200 / 401

In production Nginx serves web/ and /photos/ statically and proxies /api/.
For local development pass --static ../web so this process serves everything.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import mimetypes
import os
import pathlib
import re
import secrets
import shutil
import threading
import time
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 60_000_000
MAX_EDGE = 1280
ID_RE = re.compile(r"^[0-9a-f]{32}$")
ROOM_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,23}$")
RESERVED_SLUGS = {"public", "rooms", "api", "photos", "wishes", "admin", "default"}
WISH_THEMES = ("crimson", "emerald", "gold", "midnight", "burgundy")
MAX_WISH_TEXT = 80
MAX_WISH_AUTHOR = 16
MAX_ROOM_TITLE = 24
MAX_ROOM_PASSCODE = 32


@dataclass
class Config:
    data_dir: pathlib.Path
    token: str
    static_dir: pathlib.Path | None = None
    max_photos: int = 60
    max_bytes: int = 15 * 1024 * 1024
    max_wishes: int = 120
    wish_rate_per_min: int = 5
    photo_rate_per_min: int = 12
    room_rate_per_min: int = 5
    max_rooms: int = 100

    @property
    def photo_dir(self) -> pathlib.Path:
        return self.data_dir / "photos"

    @property
    def rooms_dir(self) -> pathlib.Path:
        return self.data_dir / "rooms"


class RateLimitError(Exception):
    pass


class RoomNotFoundError(Exception):
    pass


class RoomForbiddenError(Exception):
    pass


class RateLimiter:
    def __init__(self):
        self.lock = threading.Lock()
        self._hits: dict[tuple[str, str], list[float]] = {}

    def check_and_hit(self, bucket: str, client_ip: str, limit: int, msg: str) -> None:
        now = time.time()
        key = (bucket, client_ip)
        with self.lock:
            recent = [ts for ts in self._hits.get(key, []) if now - ts < 60.0]
            if len(recent) >= limit:
                self._hits[key] = recent
                raise RateLimitError(msg)
            recent.append(now)
            self._hits[key] = recent


def _hash_passcode(passcode: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", passcode.encode("utf-8"), salt.encode("ascii"), 100_000).hex()


def _atomic_write_json(path: pathlib.Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), "utf-8")
    os.replace(tmp, path)


def _read_json(path: pathlib.Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


class SpaceManager:
    """Manages public space and optional isolated room spaces."""

    def __init__(self, cfg: Config, limiter: RateLimiter):
        self.cfg = cfg
        self.limiter = limiter
        self.lock = threading.Lock()
        cfg.photo_dir.mkdir(parents=True, exist_ok=True)
        cfg.rooms_dir.mkdir(parents=True, exist_ok=True)

    def normalize_slug(self, raw: str | None) -> str:
        s = (raw or "").strip().lower()
        return "public" if not s or s == "public" else s

    def _meta_path(self, slug: str) -> pathlib.Path:
        return self.cfg.rooms_dir / slug / "meta.json"

    def get_meta(self, slug: str) -> dict:
        if slug == "public":
            return {"slug": "public", "title": "公共圣诞树", "locked": False}
        if not ROOM_RE.match(slug):
            raise RoomNotFoundError("空间不存在")
        meta = _read_json(self._meta_path(slug), None)
        if not meta:
            raise RoomNotFoundError("该圣诞树空间不存在")
        return meta

    def check_access(self, slug: str, passcode: str, is_admin: bool) -> dict:
        meta = self.get_meta(slug)
        if not meta.get("passcode_hash") or is_admin:
            return meta
        if passcode:
            digest = _hash_passcode(passcode, meta["salt"])
            if secrets.compare_digest(digest, meta["passcode_hash"]):
                return meta
        raise RoomForbiddenError("该专属圣诞树需要访问密码")

    def public_room_info(self, slug: str, passcode: str, is_admin: bool) -> dict:
        meta = self.get_meta(slug)
        locked = bool(meta.get("passcode_hash"))
        authorized = True
        if locked and not is_admin:
            authorized = bool(passcode) and secrets.compare_digest(
                _hash_passcode(passcode, meta["salt"]), meta["passcode_hash"]
            )
        return {
            "slug": meta["slug"],
            "title": meta["title"],
            "locked": locked,
            "authorized": authorized,
            "url": "/" if meta["slug"] == "public" else f"/?tree={meta['slug']}",
        }

    def list_rooms(self) -> list[dict]:
        out = []
        with self.lock:
            for d in sorted(self.cfg.rooms_dir.iterdir()):
                if not d.is_dir():
                    continue
                meta = _read_json(d / "meta.json", None)
                if meta:
                    out.append({
                        "slug": meta["slug"],
                        "title": meta["title"],
                        "locked": bool(meta.get("passcode_hash")),
                        "t": meta.get("t", 0),
                    })
        return sorted(out, key=lambda r: r.get("t", 0), reverse=True)

    def create_room(self, raw_slug: str, raw_title: str, raw_passcode: str, client_ip: str) -> dict:
        slug = (raw_slug or "").strip().lower()
        title = re.sub(r"[\r\n\t]+", " ", str(raw_title or "")).strip()
        passcode = str(raw_passcode or "").strip()

        if len(title) > MAX_ROOM_TITLE:
            raise ValueError(f"空间名称不能超过 {MAX_ROOM_TITLE} 个字")
        if len(passcode) > MAX_ROOM_PASSCODE:
            raise ValueError(f"访问密码不能超过 {MAX_ROOM_PASSCODE} 位")

        if slug:
            if slug in RESERVED_SLUGS or not ROOM_RE.match(slug):
                raise ValueError("空间编号需为 2~24 位字母、数字、- 或 _（不能使用保留词）")
        else:
            alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
            for _ in range(20):
                cand = "xmas-" + "".join(secrets.choice(alphabet) for _ in range(5))
                if not self._meta_path(cand).exists():
                    slug = cand
                    break

        self.limiter.check_and_hit("room", client_ip, self.cfg.room_rate_per_min, "创建空间太频繁，请稍后再试")

        with self.lock:
            existing = [d for d in self.cfg.rooms_dir.iterdir() if d.is_dir()]
            if len(existing) >= self.cfg.max_rooms:
                raise OverflowError(f"最多只能创建 {self.cfg.max_rooms} 个隔离空间")
            meta_path = self._meta_path(slug)
            if meta_path.exists():
                raise FileExistsError("该空间编号已被占用，换一个试试")
            salt = secrets.token_hex(12) if passcode else ""
            meta = {
                "slug": slug,
                "title": title or f"专属树 · {slug}",
                "salt": salt,
                "passcode_hash": _hash_passcode(passcode, salt) if passcode else "",
                "t": int(time.time()),
            }
            _atomic_write_json(meta_path, meta)
            return self.public_room_info(slug, passcode, is_admin=True)

    def delete_room(self, slug: str) -> bool:
        if slug == "public" or not ROOM_RE.match(slug):
            return False
        with self.lock:
            rdir = self.cfg.rooms_dir / slug
            if not rdir.is_dir():
                return False
            shutil.rmtree(rdir, ignore_errors=True)
            shutil.rmtree(self.cfg.photo_dir / "rooms" / slug, ignore_errors=True)
            return True

    def photo_paths(self, slug: str) -> tuple[pathlib.Path, pathlib.Path, str]:
        if slug == "public":
            return self.cfg.data_dir / "photos.json", self.cfg.photo_dir, "/photos"
        return (
            self.cfg.rooms_dir / slug / "photos.json",
            self.cfg.photo_dir / "rooms" / slug,
            f"/photos/rooms/{slug}",
        )

    def wish_index_path(self, slug: str) -> pathlib.Path:
        if slug == "public":
            return self.cfg.data_dir / "wishes.json"
        return self.cfg.rooms_dir / slug / "wishes.json"


class PhotoStore:
    def __init__(self, cfg: Config, spaces: SpaceManager, limiter: RateLimiter):
        self.cfg = cfg
        self.spaces = spaces
        self.limiter = limiter
        self.lock = threading.Lock()

    def list(self, slug: str) -> list[dict]:
        index_path, _, url_prefix = self.spaces.photo_paths(slug)
        with self.lock:
            return [self._public(p, url_prefix) for p in _read_json(index_path, [])]

    @staticmethod
    def _public(p: dict, url_prefix: str) -> dict:
        return {"id": p["id"], "url": f"{url_prefix}/{p['id']}.jpg", "w": p["w"], "h": p["h"]}

    def add(self, slug: str, raw: bytes, client_ip: str, bypass_rate: bool = False) -> dict:
        if not bypass_rate:
            self.limiter.check_and_hit("photo", client_ip, self.cfg.photo_rate_per_min, "上传太频繁啦，请稍等一分钟再试")
        img = Image.open(io.BytesIO(raw))
        img.load()
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg
        else:
            img = img.convert("RGB")
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
        pid = uuid.uuid4().hex
        index_path, photo_dir, url_prefix = self.spaces.photo_paths(slug)
        photo_dir.mkdir(parents=True, exist_ok=True)
        with self.lock:
            items = _read_json(index_path, [])
            if len(items) >= self.cfg.max_photos:
                raise OverflowError
            img.save(photo_dir / f"{pid}.jpg", "JPEG", quality=86, optimize=True, progressive=True)
            rec = {"id": pid, "w": img.width, "h": img.height, "t": int(time.time())}
            items.append(rec)
            _atomic_write_json(index_path, items)
        return self._public(rec, url_prefix)

    def delete(self, slug: str, pid: str) -> bool:
        if not ID_RE.match(pid):
            return False
        index_path, photo_dir, _ = self.spaces.photo_paths(slug)
        with self.lock:
            items = _read_json(index_path, [])
            rest = [p for p in items if p["id"] != pid]
            if len(rest) == len(items):
                return False
            _atomic_write_json(index_path, rest)
            (photo_dir / f"{pid}.jpg").unlink(missing_ok=True)
            return True


class WishStore:
    def __init__(self, cfg: Config, spaces: SpaceManager, limiter: RateLimiter):
        self.cfg = cfg
        self.spaces = spaces
        self.limiter = limiter
        self.lock = threading.Lock()

    def list(self, slug: str) -> list[dict]:
        index_path = self.spaces.wish_index_path(slug)
        with self.lock:
            return list(reversed(_read_json(index_path, [])))

    def add(self, slug: str, text: str, author: str, theme: str, client_ip: str) -> dict:
        clean_text = re.sub(r"[\r\n\t]+", " ", str(text or "")).strip()
        clean_author = re.sub(r"[\r\n\t]+", " ", str(author or "")).strip() or "匿名"
        clean_theme = theme if theme in WISH_THEMES else WISH_THEMES[0]
        if not clean_text:
            raise ValueError("祝福内容不能为空")
        if len(clean_text) > MAX_WISH_TEXT:
            raise ValueError(f"祝福不能超过 {MAX_WISH_TEXT} 个字")
        if len(clean_author) > MAX_WISH_AUTHOR:
            raise ValueError(f"署名不能超过 {MAX_WISH_AUTHOR} 个字")

        self.limiter.check_and_hit("wish", client_ip, self.cfg.wish_rate_per_min, "写得太快啦，请稍等一分钟再挂下一张祝福签")
        index_path = self.spaces.wish_index_path(slug)
        with self.lock:
            items = _read_json(index_path, [])
            if len(items) >= self.cfg.max_wishes:
                raise OverflowError(f"这棵树上最多只能挂 {self.cfg.max_wishes} 张祝福签")
            rec = {
                "id": uuid.uuid4().hex,
                "text": clean_text,
                "author": clean_author,
                "theme": clean_theme,
                "t": int(time.time()),
            }
            items.append(rec)
            _atomic_write_json(index_path, items)
            return rec

    def delete(self, slug: str, wid: str) -> bool:
        if not ID_RE.match(wid):
            return False
        index_path = self.spaces.wish_index_path(slug)
        with self.lock:
            items = _read_json(index_path, [])
            rest = [w for w in items if w["id"] != wid]
            if len(rest) == len(items):
                return False
            _atomic_write_json(index_path, rest)
            return True


def make_handler(cfg: Config, spaces: SpaceManager, store: PhotoStore, wishes: WishStore):
    class Handler(BaseHTTPRequestHandler):
        server_version = "XmasTree/1.2"

        def log_message(self, fmt, *args):
            if os.environ.get("XMAS_QUIET") != "1":
                super().log_message(fmt, *args)

        def _json(self, status: int, obj: dict) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _authed(self) -> bool:
            given = self.headers.get("X-Admin-Token", "")
            return bool(cfg.token) and secrets.compare_digest(given.encode(), cfg.token.encode())

        def _parsed(self):
            return urlparse(self.path)

        def _tree_slug(self) -> str:
            qs = parse_qs(self._parsed().query)
            return spaces.normalize_slug(qs.get("tree", [""])[0])

        def _room_passcode(self) -> str:
            return self.headers.get("X-Room-Passcode", "").strip()

        def _client_ip(self) -> str:
            real_ip = self.headers.get("X-Real-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            return real_ip or self.client_address[0]

        def _require_space(self) -> str | None:
            slug = self._tree_slug()
            try:
                spaces.check_access(slug, self._room_passcode(), self._authed())
                return slug
            except RoomNotFoundError as e:
                self._json(404, {"error": str(e)})
            except RoomForbiddenError as e:
                self._json(403, {"error": str(e), "locked": True})
            return None

        # ---- routes
        def do_GET(self):
            path = unquote(self._parsed().path)
            if path == "/api/auth":
                return self._json(200, {"ok": True}) if self._authed() else self._json(401, {"error": "口令错误"})
            if path == "/api/rooms":
                if not self._authed():
                    return self._json(401, {"error": "口令错误"})
                return self._json(200, {"rooms": spaces.list_rooms()})
            if path.startswith("/api/rooms/"):
                slug = spaces.normalize_slug(path[len("/api/rooms/"):])
                try:
                    info = spaces.public_room_info(slug, self._room_passcode(), self._authed())
                    return self._json(200, {"room": info})
                except RoomNotFoundError as e:
                    return self._json(404, {"error": str(e)})
            if path == "/api/photos":
                slug = self._require_space()
                if slug is not None:
                    return self._json(200, {"photos": store.list(slug)})
                return
            if path == "/api/wishes":
                slug = self._require_space()
                if slug is not None:
                    return self._json(200, {"wishes": wishes.list(slug)})
                return
            if path.startswith("/photos/"):
                return self._file(cfg.photo_dir, path[len("/photos/"):])
            if cfg.static_dir is not None and not path.startswith("/api/"):
                return self._file(cfg.static_dir, path.lstrip("/") or "index.html")
            return self._json(404, {"error": "not found"})

        def do_POST(self):
            path = self._parsed().path
            if path == "/api/rooms":
                return self._post_room()
            if path == "/api/wishes":
                return self._post_wish()
            if path == "/api/photos":
                return self._post_photo()
            return self._json(404, {"error": "not found"})

        def _drain_and_413(self, length: int):
            remaining = min(length, cfg.max_bytes * 4)
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
            self.close_connection = True
            return self._json(413, {"error": f"图片不能超过 {cfg.max_bytes // 1024 // 1024}MB"})

        def _post_photo(self):
            slug = self._require_space()
            if slug is None:
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return self._json(400, {"error": "空文件"})
            if length > cfg.max_bytes:
                return self._drain_and_413(length)
            raw = self.rfile.read(length)
            try:
                photo = store.add(slug, raw, self._client_ip(), bypass_rate=self._authed())
            except RateLimitError as e:
                return self._json(429, {"error": str(e)})
            except OverflowError:
                return self._json(409, {"error": f"这棵树最多只能保存 {cfg.max_photos} 张照片"})
            except Exception:
                return self._json(400, {"error": "无法识别的图片格式"})
            return self._json(201, {"photo": photo})

        def _post_wish(self):
            slug = self._require_space()
            if slug is None:
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 4096:
                return self._json(400, {"error": "请求内容格式不正确"})
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError
            except Exception:
                return self._json(400, {"error": "JSON 格式错误"})
            try:
                wish = wishes.add(
                    slug,
                    payload.get("text", ""),
                    payload.get("author", ""),
                    payload.get("theme", ""),
                    self._client_ip(),
                )
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            except RateLimitError as e:
                return self._json(429, {"error": str(e)})
            except OverflowError as e:
                return self._json(409, {"error": str(e)})
            return self._json(201, {"wish": wish})

        def _post_room(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 4096:
                return self._json(400, {"error": "请求内容格式不正确"})
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError
            except Exception:
                return self._json(400, {"error": "JSON 格式错误"})
            try:
                room = spaces.create_room(
                    payload.get("slug", ""),
                    payload.get("title", ""),
                    payload.get("passcode", ""),
                    self._client_ip(),
                )
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            except FileExistsError as e:
                return self._json(409, {"error": str(e)})
            except OverflowError as e:
                return self._json(409, {"error": str(e)})
            except RateLimitError as e:
                return self._json(429, {"error": str(e)})
            return self._json(201, {"room": room})

        def do_DELETE(self):
            path = unquote(self._parsed().path)
            if path.startswith("/api/photos/"):
                if not self._authed():
                    return self._json(401, {"error": "口令错误"})
                slug = self._tree_slug()
                try:
                    spaces.get_meta(slug)
                except RoomNotFoundError:
                    return self._json(404, {"error": "not found"})
                if store.delete(slug, path[len("/api/photos/"):]):
                    return self._json(200, {"ok": True})
                return self._json(404, {"error": "not found"})
            if path.startswith("/api/wishes/"):
                if not self._authed():
                    return self._json(401, {"error": "口令错误"})
                slug = self._tree_slug()
                try:
                    spaces.get_meta(slug)
                except RoomNotFoundError:
                    return self._json(404, {"error": "not found"})
                if wishes.delete(slug, path[len("/api/wishes/"):]):
                    return self._json(200, {"ok": True})
                return self._json(404, {"error": "not found"})
            if path.startswith("/api/rooms/"):
                if not self._authed():
                    return self._json(401, {"error": "口令错误"})
                slug = spaces.normalize_slug(path[len("/api/rooms/"):])
                if spaces.delete_room(slug):
                    return self._json(200, {"ok": True})
                return self._json(404, {"error": "not found"})
            return self._json(404, {"error": "not found"})

        def _file(self, root: pathlib.Path, rel: str):
            root = root.resolve()
            target = (root / unquote(rel)).resolve()
            if target.is_dir():
                target = target / "index.html"
            if root not in target.parents or not target.is_file():
                return self._json(404, {"error": "not found"})
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix in (".js", ".mjs"):
                ctype = "text/javascript"
            elif target.suffix == ".wasm":
                ctype = "application/wasm"
            data = target.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Handler


class XmasHTTPServer(ThreadingHTTPServer):
    request_queue_size = 128
    allow_reuse_address = True
    daemon_threads = True


def make_server(host: str, port: int, cfg: Config) -> ThreadingHTTPServer:
    limiter = RateLimiter()
    spaces = SpaceManager(cfg, limiter)
    store = PhotoStore(cfg, spaces, limiter)
    wishes = WishStore(cfg, spaces, limiter)
    return XmasHTTPServer((host, port), make_handler(cfg, spaces, store, wishes))


def main() -> None:
    here = pathlib.Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("XMAS_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("XMAS_PORT", "8095")))
    ap.add_argument("--data", default=os.environ.get("XMAS_DATA_DIR", str(here.parent / "data")))
    ap.add_argument("--static", default=None, help="serve this web dir too (dev mode)")
    a = ap.parse_args()
    cfg = Config(data_dir=pathlib.Path(a.data), token=os.environ.get("XMAS_ADMIN_TOKEN", ""),
                 static_dir=pathlib.Path(a.static) if a.static else None)
    if not cfg.token:
        print("WARNING: XMAS_ADMIN_TOKEN not set - admin deletes are disabled")
    srv = make_server(a.host, a.port, cfg)
    print(f"Xmas tree backend on http://{a.host}:{a.port}  data={cfg.data_dir}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
