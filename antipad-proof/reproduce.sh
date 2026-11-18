#!/usr/bin/env bash
set -euo pipefail
proof_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
dependencies_root="${1:?Pass the installed full-board harness node_modules directory}"
result_path="${2:-$proof_root/result.json}"
runtime_root="$(mktemp -d /tmp/fanout-antipad-2410.XXXXXX)"
trap 'rm -rf -- "$runtime_root"' EXIT

python - "$dependencies_root" "$runtime_root" <<'PY'
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import urllib.request

dependencies = Path(sys.argv[1]).resolve()
runtime = Path(sys.argv[2])
assert dependencies.is_dir(), "Installed harness dependencies are required"
modules = runtime / "node_modules"
modules.mkdir()
for package in dependencies.iterdir():
    if package.name == "@tscircuit":
        scope = modules / package.name
        scope.mkdir()
        for scoped_package in package.iterdir():
            if scoped_package.name != "props":
                (scope / scoped_package.name).symlink_to(scoped_package.resolve())
    else:
        (modules / package.name).symlink_to(package.resolve())

archives = []
for package, version, destination, expected_sha256 in [
    ("core", "0.0.2410", runtime, "97fee8e1ecfa5ff76f5fd7b0e4568518e3e58beca19b2dd35419e7d4a9b5a920"),
    ("props", "0.0.735", modules / "@tscircuit/props", "2a2ff7b7ed61e1772855a5dcb0cc0b42454d4d40b817df8932e9802f89ceca64"),
]:
    url = f"https://registry.npmjs.org/@tscircuit/{package}/-/{package}-{version}.tgz"
    archive = urllib.request.urlopen(url).read()
    assert hashlib.sha256(archive).hexdigest() == expected_sha256
    archives.append({"url": url, "sha256": hashlib.sha256(archive).hexdigest()})
    destination.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            relative = Path(member.name).relative_to("package")
            if relative == Path("package.json") or (
                str(relative).startswith("dist/") and relative.suffix == ".js"
            ):
                target = destination / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tar.extractfile(member).read())
    if package == "core":
        # Keep the package's relative chunk imports while exposing one entry.
        (runtime / "index.js").symlink_to(runtime / "dist/index.js")
(runtime / "archives.json").write_text(json.dumps(archives))
PY

bun "$proof_root/prove-antipad.ts" "$runtime_root" "$result_path"
