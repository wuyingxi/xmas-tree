"""Bundle web/, server/, deploy/ into release.tar.gz with LF endings + pre-compressed .gz sidecars."""
import gzip
import io
import pathlib
import tarfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "release.tar.gz"
DIRS = ("web", "server", "deploy")
TEXT_EXTS = {".sh", ".conf", ".service", ".py", ".html", ".css", ".js", ".mjs"}
PRECOMPRESS_EXTS = {".js", ".mjs", ".wasm", ".task", ".css"}


def add_bytes(tar: tarfile.TarFile, rel: str, data: bytes, mode: int = 0o644) -> None:
    info = tarfile.TarInfo(name=rel)
    info.size = len(data)
    info.mode = mode
    tar.addfile(info, io.BytesIO(data))


def main() -> None:
    count = 0
    gz_count = 0
    with tarfile.open(OUT, "w:gz") as tar:
        for d in DIRS:
            base = ROOT / d
            for p in sorted(base.rglob("*")):
                if not p.is_file():
                    continue
                if "__pycache__" in p.parts or p.name == "test_app.py" or p.suffix == ".gz":
                    continue
                rel = p.relative_to(ROOT).as_posix()
                data = p.read_bytes()
                if p.suffix in TEXT_EXTS:
                    data = data.replace(b"\r\n", b"\n")
                add_bytes(tar, rel, data, 0o755 if p.suffix == ".sh" else 0o644)
                count += 1
                # Pre-compress static web assets (>10 KB) for nginx gzip_static on;
                if d == "web" and p.suffix in PRECOMPRESS_EXTS and len(data) > 10_240:
                    gz = gzip.compress(data, compresslevel=9)
                    if len(gz) < len(data) * 0.95:
                        add_bytes(tar, rel + ".gz", gz, 0o644)
                        gz_count += 1
    print(f"Packaged {count} files + {gz_count} pre-gzipped sidecars -> {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
