"""Restore one diagnostic fanout SRJ from its original captured input and patch.

Usage: python3 reconstruct-output.py INPUT.json.gz PATCH.json.gz OUTPUT.json.gz
The output preserves the JSON object, not the original gzip byte encoding.
"""

import copy
import gzip
import hashlib
import json
import sys
from pathlib import Path

input_path, patch_path, output_path = map(Path, sys.argv[1:])
input_bytes = gzip.decompress(input_path.read_bytes())
original = json.loads(input_bytes)
patch = json.loads(gzip.decompress(patch_path.read_bytes()))
if hashlib.sha256(input_bytes).hexdigest() != patch["inputSha256"]:
    raise ValueError("Captured input SHA256 does not match the patch")
original_obstacles = original["solverParams"]["obstacles"]
if len(original_obstacles) != patch["retainedInputObstacleCount"]:
    raise ValueError("Captured obstacle count does not match the patch")
output = copy.deepcopy(patch["outputWithAppendedObstaclesOnly"])
output["obstacles"] = original_obstacles + output["obstacles"]
output_path.write_bytes(
    gzip.compress(json.dumps(output, separators=(",", ":")).encode(), mtime=0)
)
