"""Verify and extract the complete original renderer output archive."""
import base64
import csv
import hashlib
import io
import json
import os
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent
target = Path(sys.argv[1] if len(sys.argv) > 1 else 'report-data').resolve()
if target.exists():
    raise RuntimeError('Refusing to replace an existing destination: ' + str(target))
manifest = json.loads((root / 'archive-manifest.json').read_text())
encoded = (root / manifest['archive']['base64File']).read_bytes()
if hashlib.sha256(encoded).hexdigest() != manifest['archive']['base64Sha256']:
    raise RuntimeError('Base64 publication bytes do not match the manifest')
payload = base64.b64decode(b''.join(encoded.split()), validate=True)
if len(payload) != manifest['archive']['bytes'] or hashlib.sha256(payload).hexdigest() != manifest['archive']['sha256']:
    raise RuntimeError('Decoded tar.gz digest or size does not match')
expected = manifest['members']
target.parent.mkdir(parents=True, exist_ok=True)
staging = Path(tempfile.mkdtemp(prefix='.report-data-', dir=target.parent))
try:
    with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if len(names) != len(set(names)) or set(names) != set(expected):
            raise RuntimeError('Unexpected, duplicate or missing archive member')
        for member in members:
            if not member.isfile() or member.name != Path(member.name).name:
                raise RuntimeError('Only the declared flat regular files may be extracted')
            data = archive.extractfile(member).read()
            record = expected[member.name]
            if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
                raise RuntimeError('Archive member digest or size mismatch: ' + member.name)
            if 'csvRows' in record:
                count = sum(1 for _ in csv.DictReader(io.StringIO(data.decode('utf-8'))))
                if count != record['csvRows']:
                    raise RuntimeError('CSV row count mismatch: ' + member.name)
            (staging / member.name).write_bytes(data)
    os.rename(staging, target)
except BaseException:
    shutil.rmtree(staging, ignore_errors=True)
    raise
print(json.dumps({'directory': str(target), 'verifiedMembers': len(expected), 'armRows': manifest['armRows'], 'archiveSha256': manifest['archive']['sha256']}))
