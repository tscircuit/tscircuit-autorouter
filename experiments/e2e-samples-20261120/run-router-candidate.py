from pathlib import Path
import json, os, subprocess, sys

sample = sys.argv[1]
workspace = Path(os.environ['GITHUB_WORKSPACE'])
revisions = json.loads(Path('revisions.json').read_text())
assert revisions['core'] == '351e73d665fad37577c47fcbff2e4c29eb377467'
assert revisions['router'] == 'f9c08dcd41bfd84beb0b17bdf8b75215a4701ac6'
revisions['variant'] = 'after'
revisions['corePatchApplied'] = False
Path('revisions.json').write_text(json.dumps(revisions, indent=2) + '\n')
output = workspace / 'results' / 'after' / sample
subprocess.run(['python3', 'run.py', sample, str(output)], check=True)
report = json.loads((output / 'report.json').read_text())
assert report['initialCopper'] == 0, (sample, 'Routed input copper')
assert not any('serialize cyclic' in message for message in report['errors'])
subprocess.run(['bun', 'assess.ts', sample, str(output)], check=True, timeout=180)
