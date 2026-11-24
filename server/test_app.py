"""Backend API tests: run with `python -m unittest discover -s server -p "test_*.py"`."""
import io
import json
import pathlib
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import app  # noqa: E402

TOKEN = "test-secret"


def make_jpeg(w=2400, h=1600, color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, "JPEG")
    return buf.getvalue()


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        cfg = app.Config(
            data_dir=pathlib.Path(self.tmp.name),
            token=TOKEN,
            static_dir=None,
            max_photos=3,
            max_bytes=5 * 1024 * 1024,
            max_wishes=4,
            wish_rate_per_min=3,
            photo_rate_per_min=5,
            max_rooms=5,
        )
        self.server = app.make_server("127.0.0.1", 0, cfg)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def req(self, method, path, body=None, token=None, headers=None):
        h = dict(headers or {})
        if token is not None:
            h["X-Admin-Token"] = token
        r = urllib.request.Request(self.base + path, data=body, method=method, headers=h)
        try:
            with urllib.request.urlopen(r) as resp:
                raw = resp.read()
                ct = resp.headers.get_content_type()
                return resp.status, (json.loads(raw) if raw and ct == "application/json" else raw)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return e.code, raw

    def post_json(self, path, obj, token=None, headers=None):
        h = {"Content-Type": "application/json", **(headers or {})}
        return self.req("POST", path, json.dumps(obj, ensure_ascii=False).encode("utf-8"), token=token, headers=h)

    def test_list_empty(self):
        self.assertEqual(self.req("GET", "/api/photos"), (200, {"photos": []}))

    def test_auth_check(self):
        self.assertEqual(self.req("GET", "/api/auth", token="wrong")[0], 401)
        self.assertEqual(self.req("GET", "/api/auth", token=TOKEN)[0], 200)

    def test_public_upload_open_and_delete_requires_admin(self):
        # Anyone can upload to public tree without admin token
        status, body = self.req("POST", "/api/photos", make_jpeg())
        self.assertEqual(status, 201)
        photo = body["photo"]
        self.assertLessEqual(max(photo["w"], photo["h"]), app.MAX_EDGE)
        self.assertEqual(photo["url"], f"/photos/{photo['id']}.jpg")

        # Image is served back cleanly
        st_img, img_bytes = self.req("GET", photo["url"])
        self.assertEqual(st_img, 200)
        self.assertGreater(len(img_bytes), 500)

        listed = self.req("GET", "/api/photos")[1]["photos"]
        self.assertEqual([p["id"] for p in listed], [photo["id"]])

        # Delete still requires admin token
        self.assertEqual(self.req("DELETE", f"/api/photos/{photo['id']}")[0], 401)
        self.assertEqual(self.req("DELETE", f"/api/photos/{photo['id']}", token="bad")[0], 401)
        self.assertEqual(self.req("DELETE", f"/api/photos/{photo['id']}", token=TOKEN)[0], 200)
        self.assertEqual(self.req("GET", "/api/photos")[1]["photos"], [])

    def test_rejects_non_image(self):
        status, _ = self.req("POST", "/api/photos", b"not an image at all")
        self.assertEqual(status, 400)

    def test_rejects_too_large(self):
        status, _ = self.req("POST", "/api/photos", b"x" * (6 * 1024 * 1024))
        self.assertEqual(status, 413)

    def test_photo_limit_and_rate_limit(self):
        for _ in range(3):
            self.assertEqual(self.req("POST", "/api/photos", make_jpeg(300, 200))[0], 201)
        self.assertEqual(self.req("POST", "/api/photos", make_jpeg(300, 200))[0], 409)

    def test_delete_rejects_path_traversal(self):
        status, _ = self.req("DELETE", "/api/photos/..%2F..%2Fetc", token=TOKEN)
        self.assertEqual(status, 404)

    def test_wishes_list_empty(self):
        self.assertEqual(self.req("GET", "/api/wishes"), (200, {"wishes": []}))

    def test_wishes_anonymous_create_list_and_admin_delete(self):
        st, body = self.post_json("/api/wishes", {"text": "圣诞快乐，愿平安喜乐！", "theme": "emerald"})
        self.assertEqual(st, 201)
        w = body["wish"]
        self.assertEqual(w["text"], "圣诞快乐，愿平安喜乐！")
        self.assertEqual(w["author"], "匿名")
        self.assertEqual(w["theme"], "emerald")

        st2, body2 = self.post_json("/api/wishes", {"text": "新年发大财", "author": "小明", "theme": "gold"})
        self.assertEqual(st2, 201)
        listed = self.req("GET", "/api/wishes")[1]["wishes"]
        self.assertEqual([x["id"] for x in listed], [body2["wish"]["id"], w["id"]])

        self.assertEqual(self.req("DELETE", f"/api/wishes/{w['id']}", token="wrong")[0], 401)
        self.assertEqual(self.req("DELETE", f"/api/wishes/{w['id']}", token=TOKEN)[0], 200)
        self.assertEqual([x["id"] for x in self.req("GET", "/api/wishes")[1]["wishes"]], [body2["wish"]["id"]])

    def test_wishes_validation(self):
        self.assertEqual(self.post_json("/api/wishes", {"text": "   "})[0], 400)
        self.assertEqual(self.post_json("/api/wishes", {"text": "祝" * 81})[0], 400)
        self.assertEqual(self.post_json("/api/wishes", {"text": "hi", "author": "名" * 17})[0], 400)
        self.assertEqual(self.req("POST", "/api/wishes", b"{not-json")[0], 400)
        st, body = self.post_json("/api/wishes", {"text": "hello", "theme": "unknown_color"})
        self.assertEqual(st, 201)
        self.assertEqual(body["wish"]["theme"], "crimson")

    def test_wishes_rate_limit_and_max_limit(self):
        for i in range(3):
            st, _ = self.post_json("/api/wishes", {"text": f"wish {i}"}, headers={"X-Real-IP": "10.0.0.1"})
            self.assertEqual(st, 201)
        self.assertEqual(
            self.post_json("/api/wishes", {"text": "spam"}, headers={"X-Real-IP": "10.0.0.1"})[0],
            429,
        )
        self.assertEqual(
            self.post_json("/api/wishes", {"text": "from friend"}, headers={"X-Real-IP": "10.0.0.2"})[0],
            201,
        )
        self.assertEqual(
            self.post_json("/api/wishes", {"text": "overflow"}, headers={"X-Real-IP": "10.0.0.2"})[0],
            409,
        )

    def test_isolated_rooms_photos_and_wishes_are_strictly_separated(self):
        # Create an open isolated room
        st, body = self.post_json("/api/rooms", {"slug": "dorm-402", "title": "402 宿舍圣诞树"})
        self.assertEqual(st, 201)
        self.assertEqual(body["room"]["slug"], "dorm-402")
        self.assertFalse(body["room"]["locked"])

        # Duplicate slug rejected
        self.assertEqual(self.post_json("/api/rooms", {"slug": "dorm-402"})[0], 409)
        # Reserved/invalid slugs rejected
        self.assertEqual(self.post_json("/api/rooms", {"slug": "public"})[0], 400)
        self.assertEqual(self.post_json("/api/rooms", {"slug": "../evil"})[0], 400)

        # Upload photo + wish into public tree vs dorm-402
        st_pub_p, pub_p = self.req("POST", "/api/photos", make_jpeg(300, 200))
        self.assertEqual(st_pub_p, 201)
        st_rm_p, rm_p = self.req("POST", "/api/photos?tree=dorm-402", make_jpeg(300, 200))
        self.assertEqual(st_rm_p, 201)
        self.assertIn("/photos/rooms/dorm-402/", rm_p["photo"]["url"])
        self.assertEqual(self.req("GET", rm_p["photo"]["url"])[0], 200)

        self.assertEqual(self.post_json("/api/wishes", {"text": "公共祝福"})[0], 201)
        self.assertEqual(self.post_json("/api/wishes?tree=dorm-402", {"text": "宿舍专属祝福"})[0], 201)

        # Verify strict isolation
        pub_photos = self.req("GET", "/api/photos")[1]["photos"]
        rm_photos = self.req("GET", "/api/photos?tree=dorm-402")[1]["photos"]
        self.assertEqual([p["id"] for p in pub_photos], [pub_p["photo"]["id"]])
        self.assertEqual([p["id"] for p in rm_photos], [rm_p["photo"]["id"]])

        pub_wishes = self.req("GET", "/api/wishes")[1]["wishes"]
        rm_wishes = self.req("GET", "/api/wishes?tree=dorm-402")[1]["wishes"]
        self.assertEqual([w["text"] for w in pub_wishes], ["公共祝福"])
        self.assertEqual([w["text"] for w in rm_wishes], ["宿舍专属祝福"])

        # Unknown room returns 404
        self.assertEqual(self.req("GET", "/api/photos?tree=nonexistent")[0], 404)
        self.assertEqual(self.req("GET", "/api/rooms/nonexistent")[0], 404)

    def test_passcode_protected_room(self):
        st, body = self.post_json("/api/rooms", {"title": "秘密基地", "passcode": "xmas2026"})
        self.assertEqual(st, 201)
        slug = body["room"]["slug"]
        self.assertTrue(body["room"]["locked"])

        # Room info shows locked & unauthorized without passcode
        st_info, info = self.req("GET", f"/api/rooms/{slug}")
        self.assertEqual(st_info, 200)
        self.assertTrue(info["room"]["locked"])
        self.assertFalse(info["room"]["authorized"])

        # Reading & writing without passcode returns 403
        self.assertEqual(self.req("GET", f"/api/photos?tree={slug}")[0], 403)
        self.assertEqual(self.req("GET", f"/api/wishes?tree={slug}")[0], 403)
        self.assertEqual(self.post_json(f"/api/wishes?tree={slug}", {"text": "偷看"})[0], 403)
        self.assertEqual(self.req("POST", f"/api/photos?tree={slug}", make_jpeg(200, 200))[0], 403)

        # Correct room passcode unlocks reading and writing
        hdr = {"X-Room-Passcode": "xmas2026"}
        self.assertEqual(self.req("GET", f"/api/rooms/{slug}", headers=hdr)[1]["room"]["authorized"], True)
        st_w, w_body = self.post_json(f"/api/wishes?tree={slug}", {"text": "悄悄话"}, headers=hdr)
        self.assertEqual(st_w, 201)
        st_p, p_body = self.req("POST", f"/api/photos?tree={slug}", make_jpeg(200, 200), headers=hdr)
        self.assertEqual(st_p, 201)
        self.assertEqual(len(self.req("GET", f"/api/photos?tree={slug}", headers=hdr)[1]["photos"]), 1)

        # Admin token bypasses room passcode and can delete room items
        self.assertEqual(self.req("GET", f"/api/wishes?tree={slug}", token=TOKEN)[0], 200)
        self.assertEqual(self.req("DELETE", f"/api/wishes/{w_body['wish']['id']}?tree={slug}", token=TOKEN)[0], 200)
        self.assertEqual(self.req("DELETE", f"/api/photos/{p_body['photo']['id']}?tree={slug}", token=TOKEN)[0], 200)
        self.assertEqual(self.req("GET", f"/api/photos?tree={slug}", headers=hdr)[1]["photos"], [])


if __name__ == "__main__":
    unittest.main()
