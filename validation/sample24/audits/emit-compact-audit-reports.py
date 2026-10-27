import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--out-dir', required=True)
args = parser.parse_args()
out = Path(args.out_dir)

for path in sorted(out.glob('*.json')):
    value = json.loads(path.read_text())
    counts = {key: item for key, item in value.items()
              if isinstance(item, (int, float, bool)) or key in
              ('scope', 'routesSha256', 'inputSha256', 'qualification')}
    for key in ('counts', 'summary', 'coverage'):
        if isinstance(value.get(key), dict):
            counts[key] = {name: item for name, item in value[key].items()
                           if isinstance(item, (int, float, bool, str)) or item is None}
    print('SAMPLE24_INDEPENDENT_AUDIT_REPORT ' + json.dumps({
        'file': path.name,
        'reportSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'counts': counts,
    }), flush=True)
