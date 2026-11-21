from pathlib import Path
import hashlib,json

root=Path('experiments/boards-3266/runtime/node_modules/@tscircuit/core')
assert json.loads((root/'package.json').read_text())['version']=='0.0.2443'
entry=root/'dist/index.js'
before=entry.read_bytes()
assert hashlib.sha256(before).hexdigest()=='302ea2a78c747edf4f2db67b2a27269b0e1b3b018116b8905ba4645b057f4371'
old='''      (p2, i2) => pointSegmentDistanceToPoints(start, p2, ring2[(i2 + 1) % ring2.length]) >= margin - epsilon'''
new='''      (p2, i2) => {
        const q = ring2[(i2 + 1) % ring2.length];
        return start.x < Math.min(p2.x, q.x) - margin || start.x > Math.max(p2.x, q.x) + margin || start.y < Math.min(p2.y, q.y) - margin || start.y > Math.max(p2.y, q.y) + margin || pointSegmentDistanceToPoints(start, p2, q) >= margin - epsilon;
      }'''
assert before.decode().count(old)==1
after=before.decode().replace(old,new).encode();entry.write_bytes(after)
provenance={
 'coreBaseVersion':'0.0.2443','busLanesBaseVersion':'0.0.62','busLanesBaseCommit':'202b034',
 'method':'Replace only the compiled point-to-outline predicate corresponding to outline-point-broad-phase.patch. Every other released dependency and byte is retained.',
 'entryBeforeSha256':hashlib.sha256(before).hexdigest(),
 'entryAfterSha256':hashlib.sha256(after).hexdigest(),
 'sourcePatchSha256':hashlib.sha256(Path('experiments/boards-3266/outline-point-broad-phase.patch').read_bytes()).hexdigest(),
}
Path('experiments/boards-3266/outline-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n');print(json.dumps(provenance))
