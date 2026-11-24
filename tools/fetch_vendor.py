"""Download Three.js + MediaPipe Tasks Vision + hand model into web/vendor (run once)."""
import io
import json
import pathlib
import shutil
import tarfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDOR = ROOT / "web" / "vendor"
REGISTRY = "https://registry.npmmirror.com"
THREE_VERSION = "0.170.0"
MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
             "hand_landmarker/float16/1/hand_landmarker.task")

# three.js addon files needed (relative to examples/jsm)
THREE_ADDONS = [
    "postprocessing/EffectComposer.js",
    "postprocessing/RenderPass.js",
    "postprocessing/ShaderPass.js",
    "postprocessing/MaskPass.js",
    "postprocessing/Pass.js",
    "postprocessing/UnrealBloomPass.js",
    "postprocessing/OutputPass.js",
    "shaders/CopyShader.js",
    "shaders/LuminosityHighPassShader.js",
    "shaders/OutputShader.js",
    "environments/RoomEnvironment.js",
    "controls/OrbitControls.js",
]


def get(url: str) -> bytes:
    print("GET", url)
    req = urllib.request.Request(url, headers={"User-Agent": "xmas-tree-fetch"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def npm_tarball(name: str, version: str) -> tarfile.TarFile:
    meta = json.loads(get(f"{REGISTRY}/{name}/{version}"))
    return tarfile.open(fileobj=io.BytesIO(get(meta["dist"]["tarball"])), mode="r:gz"), meta["version"]


def extract(tar: tarfile.TarFile, member: str, dest: pathlib.Path) -> None:
    data = tar.extractfile(f"package/{member}").read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)


def main() -> None:
    if VENDOR.exists():
        shutil.rmtree(VENDOR)

    tar, v = npm_tarball("three", THREE_VERSION)
    print("three", v)
    extract(tar, "build/three.module.js", VENDOR / "three/build/three.module.js")
    extract(tar, "build/three.core.js", VENDOR / "three/build/three.core.js") if any(
        m.name == "package/build/three.core.js" for m in tar.getmembers()) else None
    for a in THREE_ADDONS:
        extract(tar, f"examples/jsm/{a}", VENDOR / "three/examples/jsm" / a)

    tar, v = npm_tarball("@mediapipe/tasks-vision", "0.10.18")
    print("tasks-vision", v)
    mp_dir = VENDOR / f"mediapipe-{v}"
    for m in tar.getmembers():
        n = m.name.removeprefix("package/")
        if n == "vision_bundle.mjs" or (n.startswith("wasm/") and not n.endswith(".map")):
            extract(tar, n, mp_dir / n)

    model = mp_dir / "models/hand_landmarker.task"
    model.parent.mkdir(parents=True, exist_ok=True)
    model.write_bytes(get(MODEL_URL))

    tar, v = npm_tarball("@fontsource/great-vibes", "latest")
    print("great-vibes", v)
    for m in tar.getmembers():
        if m.name.endswith("great-vibes-latin-400-normal.woff2"):
            extract(tar, m.name.removeprefix("package/"), VENDOR / "fonts/great-vibes-latin.woff2")
            break

    total = sum(p.stat().st_size for p in VENDOR.rglob("*") if p.is_file())
    print(f"done, vendor size {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
