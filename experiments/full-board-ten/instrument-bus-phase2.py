"""Expose the native adapter and pipeline from one exact Core; change no existing bytes."""
import argparse
import hashlib
import json
from pathlib import Path

CORE_SHA = '426044a899711814d034b6b0e3574e1de541252e03ed04263a3af83c610eb898'
TAIL = b'\nexport { BusLanesPipelineSolver as __busDiagPipeline, getBusLanesInputFromSrj as __busDiagAdapt, validateRoutedCopperDrc3 as __busDiagDrc, validateOriginalEndpointConnectivity3 as __busDiagConnectivity };\n'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('dest', type=Path)
args = parser.parse_args()
assert args.source.resolve() != args.dest.resolve()
raw = args.source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == CORE_SHA
assert b'__busDiag' not in raw and raw.count(b'function getBusLanesInputFromSrj(') == 1
observed = raw + TAIL
args.dest.parent.mkdir(parents=True, exist_ok=True)
args.dest.write_bytes(observed)
print(json.dumps({'sourceSha256': CORE_SHA, 'instrumentedSha256': hashlib.sha256(observed).hexdigest(), 'sourcePrefixExact': True, 'replacementCount': 0, 'appendedBytes': len(TAIL), 'appendedTail': TAIL.decode(), 'existingSourceBytesChanged': False}))
