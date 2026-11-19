"""Verify the exact worker PCB SVG against the unchanged native rendering."""

import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile

archive_path = Path(sys.argv[1])
board = sys.argv[2]
baseline = Path('/workspace/ddr-rerun-2427/baseline/boards') / board / 'pcb.svg'
with zipfile.ZipFile(archive_path) as archive:
    members = [name for name in archive.namelist() if Path(name).name == 'pcb.svg']
    assert len(members) == 1
    rendered = archive.read(members[0])
same = rendered == baseline.read_bytes()
report = {
    'board': board,
    'workerSvgSha256': hashlib.sha256(rendered).hexdigest(),
    'baselineSvgSha256': hashlib.sha256(baseline.read_bytes()).hexdigest(),
    'sameWorkerSvgBytes': same,
    'artifactMember': members[0],
}
folder = Path('/workspace/ddr-stack-2427/full-qualified') / board
(folder / 'pcb-svg-hashes.json').write_text(json.dumps(report, indent=2) + '\n')
worker = folder / 'worker-pcb.svg'
if worker.exists():
    worker.unlink()
if same:
    os.link(baseline, worker)
else:
    worker.write_bytes(rendered)
archive_path.unlink()
print(json.dumps(report))
assert same, 'Fresh worker SVG differs; use actual worker output and inspect it.'
