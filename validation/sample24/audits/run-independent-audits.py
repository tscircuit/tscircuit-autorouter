#!/usr/bin/env python3
"""Run independent final artifact audits sequentially; never discard failing reports."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(os.environ['SAMPLE24_AUDIT_SOURCE_ROOT']).resolve()
INPUT = Path(os.environ['SAMPLE24_AUDIT_ORIGINAL_INPUT']).resolve()
INPUT_SHA = 'ba157c96251e5c53964a7fb529981fc19347865c82379558bf820fcdef6b52a7'


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--routes', required=True)
    parser.add_argument('--out-dir', required=True)
    args = parser.parse_args()
    final = Path(args.routes).resolve()
    out = Path(args.out_dir).resolve()
    if sha(INPUT) != INPUT_SHA:
        raise ValueError('Original input SHA mismatch')
    if out.exists():
        raise ValueError('Audit output must be new')
    out.mkdir(parents=True)
    env = os.environ.copy()
    env['PATH'] = env.get('PATH', '')
    bun = shutil.which('bun', path=env['PATH'])
    if not bun:
        raise ValueError('Bun unavailable')
    manifest = {'scope': 'FINAL_INDEPENDENT_AUDIT_COMMAND_MANIFEST_NOT_COMPLETION_PROOF',
                'routesPath': str(final), 'routesSha256': sha(final),
                'inputSha256': INPUT_SHA, 'runnerSha256': sha(__file__), 'commands': []}

    def run(name, command):
        began = time.monotonic()
        with open(out / (name + '.log'), 'x') as log:
            result = subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        item = {'name': name, 'arguments': list(map(str, command)),
                'exitCode': result.returncode, 'elapsedSeconds': time.monotonic() - began}
        manifest['commands'].append(item)
        (out / 'audit-command-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print(json.dumps(item), flush=True)

    common = ['--input', str(INPUT), '--routes', str(final)]
    run('reference', [bun, 'tmp/prepare-sample24-final-reference-audit.ts', *common, '--out-dir', str(out)])
    run('ordinary-wires-raw-opaque', [sys.executable, 'tmp/check-sample24-final-ordinary-wires-opaque.py', *common,
                                    '--report', str(out / 'final-ordinary-wires-opaque-independent.json'), '--final'])
    for clearance, name in [('0', 'final-vias-raw-independent'), ('0.1', 'final-vias-raw-clearance-0p1-independent')]:
        run(name, [sys.executable, 'tmp/check-sample24-final-vias-raw.py', *common,
                   '--report', str(out / (name + '.json')), '--clearance', clearance, '--final'])
    run('final-via-pairs-independent', [sys.executable, 'tmp/check-sample24-final-via-pairs.py',
                                      *common, '--report', str(out / 'final-via-pairs-independent.json')])
    projections = out / 'final-through-projections.json'
    run('through-projections', [bun, 'tmp/collect-through-obstacle-projections.ts', '--routes', str(final),
                                '--output', str(projections), '--layer-count', '8'])
    marker_count = json.loads(projections.read_text())['markerCount'] if projections.exists() else None
    through_args = []
    if marker_count:
        through = out / 'final-through-clearance-independent.json'
        run('through-clearance', [sys.executable, 'tmp/check-through-obstacle-physical-clearance.py',
                                  *common, '--projections', str(projections), '--report', str(through), '--final'])
        through_args = ['--through-report', str(through)]
    run('clearance-classification', [sys.executable, 'tmp/classify-sample24-final-clearances.py', *common,
                                    '--via-report', str(out / 'final-vias-raw-clearance-0p1-independent.json'),
                                    *through_args, '--report', str(out / 'final-independent-clearance-classification.json')])
    run('electrical-terminal-access', [sys.executable, 'tmp/verify-sample24-final-electrical.py', *common,
                                      '--roster', str(out / 'original-mst-roster.json'), *through_args,
                                      '--report', str(out / 'final-electrical-and-terminal-access.json')])
    run('independent-conductive-union', [sys.executable, str(ROOT / 'tmp/check-sample24-final-conductive-union.py'), *common,
                                       '--projections', str(projections), *through_args,
                                       '--report', str(out / 'final-independent-conductive-union.json')])
    reports = {}
    for path in out.glob('*.json'):
        if path.name != 'audit-command-manifest.json':
            value = json.loads(path.read_text())
            reports[path.name] = {'sha256': sha(path), 'reportedRoutesSha256': value.get('routesSha256'),
                                 'reportedInputSha256': value.get('inputSha256'),
                                 'stageCoverage': value.get('stageCoverage'),
                                 'counts': {key: item for key, item in value.items()
                                            if isinstance(item, (int, bool, float)) or key == 'scope'}}
    manifest['reports'] = reports
    manifest['markerCount'] = marker_count
    manifest['routesBytesUnchanged'] = sha(final) == manifest['routesSha256']
    manifest['qualification'] = ('All report counts and classified physical deficits require review; '
                                 'exit zero alone never certifies a solved board or clearance.')
    (out / 'audit-command-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return 1 if any(item['exitCode'] for item in manifest['commands']) or marker_count is None else 0


if __name__ == '__main__':
    raise SystemExit(main())
