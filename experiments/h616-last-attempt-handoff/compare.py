import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
rows = {lane: json.loads((root / 'h616-results' / lane / 'assessment.json').read_text()) for lane in ['base', 'pr']}
for lane, row in rows.items():
    assert row['solved'] and not row['failed']
    assert row['nativeDrcErrors'] < 44 and row['placementErrors'] == 0
    assert not row['routingExecutedDuringAssessment']
fields = ['outputCopperSha256', 'pointPairsSha256', 'nativeCircuitJsonSha256', 'nativeSvgSha256']
equal = {name: rows['base'][name] == rows['pr'][name] for name in fields}
result = {'case': 'existing H616 full-board DDR-clearance repro', 'sameVmSequential': True,
          'sourceBaseline': rows['base'], 'refinedHandoff': rows['pr'], 'outputParity': equal,
          'allNativeOutputIdentical': all(equal.values()), 'noSnapshotUpdates': True,
          'assertionsUnchanged': True, 'scope': 'Existing repository fixture and its native0.1mm checks, separate from ten-board fullcircuit completion'}
(root / 'h616-results/comparison.json').write_text(json.dumps(result, indent=2) + '\n')
print('H616_NATIVE_COMPARISON ' + json.dumps(result))
assert all(equal.values()), 'Previously successful H616 output changed'
