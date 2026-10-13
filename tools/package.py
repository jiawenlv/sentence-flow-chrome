"""Build a clean load-unpacked folder and a distributable zip (stdlib only)."""
from pathlib import Path
import json
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text())
dest = root / "dist" / "sentence-flow"
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir(parents=True)
for name in ["manifest.json", "background", "content", "shared", "options", "icons"]:
    source = root / name
    if source.is_dir():
        shutil.copytree(source, dest / name)
    else:
        shutil.copy2(source, dest / name)
for name in ["README.md", "PRIVACY.md", "LICENSE", "REFERENCES.md", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md"]:
    if (root / name).exists():
        shutil.copy2(root / name, dest / name)
shutil.copytree(root / "docs", dest / "docs")
archive = root / "dist" / f"sentence-flow-{manifest['version']}.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
    for file in sorted(dest.rglob("*")):
        if file.is_file():
            bundle.write(file, Path("sentence-flow") / file.relative_to(dest))
print(f"Unpacked extension: {dest}\nZIP: {archive}")
