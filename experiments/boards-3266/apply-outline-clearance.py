from pathlib import Path
import hashlib,json

root=Path('experiments/boards-3266/runtime/node_modules/@tscircuit/core')
assert json.loads((root/'package.json').read_text())['version']=='0.0.2443'
entry=root/'dist/index.js'
before=entry.read_bytes()
assert hashlib.sha256(before).hexdigest()=='302ea2a78c747edf4f2db67b2a27269b0e1b3b018116b8905ba4645b057f4371'
old='  const ring2 = input.outline;\n  if (!ring2?.length) return true;\n  if (start.x === end.x && start.y === end.y)\n    return inside2(start, ring2) && ring2.every(\n      (p2, i2) => pointSegmentDistanceToPoints(start, p2, ring2[(i2 + 1) % ring2.length]) >= margin - epsilon\n    );\n  if (!inside2(start, ring2) || !inside2(end, ring2)) return false;\n  return ring2.every(\n    (p2, i2) => segmentDistance3([start, end], [p2, ring2[(i2 + 1) % ring2.length]]) >= margin - epsilon\n  );'
new='  const ring2 = input.outline;\n  if (!ring2?.length) return true;\n  const isPoint = start.x === end.x && start.y === end.y;\n  if (!inside2(start, ring2) || (!isPoint && !inside2(end, ring2))) return false;\n  const minX = Math.min(start.x, end.x) - margin, maxX = Math.max(start.x, end.x) + margin, minY = Math.min(start.y, end.y) - margin, maxY = Math.max(start.y, end.y) + margin;\n  return ring2.every((p2, i2) => {\n    const q = ring2[(i2 + 1) % ring2.length];\n    if (Math.max(p2.x, q.x) < minX || Math.min(p2.x, q.x) > maxX || Math.max(p2.y, q.y) < minY || Math.min(p2.y, q.y) > maxY) return true;\n    return (isPoint ? pointSegmentDistanceToPoints(start, p2, q) : segmentDistance3([start, end], [p2, q])) >= margin - epsilon;\n  });'
assert before.decode().count(old)==1
after=before.decode().replace(old,new).encode();entry.write_bytes(after)
provenance={
 'coreBaseVersion':'0.0.2443','busLanesBaseVersion':'0.0.62','busLanesBaseCommit':'202b034',
 'method':'Replace only the compiled outline-clearance predicate corresponding to outline-clearance.patch. Every other released dependency and byte is retained.',
 'entryBeforeSha256':hashlib.sha256(before).hexdigest(),
 'entryAfterSha256':hashlib.sha256(after).hexdigest(),
 'sourcePatchSha256':hashlib.sha256(Path('experiments/boards-3266/outline-clearance.patch').read_bytes()).hexdigest(),
}
Path('experiments/boards-3266/outline-clearance-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n');print(json.dumps(provenance))
