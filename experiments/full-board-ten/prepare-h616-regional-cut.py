"""Fetch one authenticated own-board capture; never generate a replacement fixture."""
import hashlib
import io
import json
from pathlib import Path
import sys
import subprocess
import zipfile

root = Path(sys.argv[1]).resolve()
controller = Path(__file__).resolve().parent
plan = json.loads((controller / 'h616-regional-cut-plan.json').read_text())
expected = plan['capture']
api = 'repos/tscircuit/tscircuit-autorouter/actions/artifacts/' + str(expected['artifactId'])
metadata = json.loads(subprocess.check_output(['gh', 'api', api], timeout=180))
assert metadata['workflow_run']['id'] == expected['runId']
assert metadata['workflow_run']['head_sha'] == expected['head']
assert metadata['name'] == expected['name'] and not metadata['expired']
assert metadata['size_in_bytes'] == expected['bytes'] and metadata['digest'] == expected['digest']
archive = subprocess.check_output(['gh', 'api', api + '/zip'], timeout=180)
assert len(archive) == expected['bytes']
assert 'sha256:' + hashlib.sha256(archive).hexdigest() == expected['digest']
output = root / 'h616-regional-cut-input'
output.mkdir()
with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
    assert len(bundle.namelist()) == len(set(bundle.namelist()))
    for name, digest in plan['files'].items():
        data = bundle.read(name)
        assert hashlib.sha256(data).hexdigest() == digest
        (output / name).write_bytes(data)
validation = json.loads((output / 'failure-witness-validation.json').read_text())
assert validation['valid'] and all(validation['checks'].values())
(output / 'input-proof.json').write_text(json.dumps({'artifact': metadata, 'fileHashes': plan['files'], 'allCaptureGatesPass': True}, indent=2) + '\n')
print(json.dumps({'prepared': str(output), 'artifactId': expected['artifactId'], 'verifiedFileCount': len(plan['files'])}))
