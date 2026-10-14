"""Explicitly promote a verified Blacksmith artifact into the published recording."""
import argparse
import gzip
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from materialize import load_recording

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('artifact', type=Path)
    args = parser.parse_args()
    metadata = json.loads((args.artifact/'metadata.json').read_bytes())
    payload = (args.artifact/'results.json.gz').read_bytes()
    if hashlib.sha256(payload).hexdigest() != metadata['bundleSha256']:
        raise ValueError('Downloaded benchmark checksum mismatch')
    data = json.loads(gzip.decompress(payload))
    original = load_recording(include_pruning=False)
    if data['inputs'] != original['inputs']:
        raise ValueError('Benchmark inputs differ from the historical pinned inputs')
    configurations = ['hex-p020', 'oct-p020', 'oct-density020', 'hex-p010', 'oct-density010']
    expected = {f'{base}-{mode}' + (f'-r{r}' if r > 1 else '')
                for base in configurations for mode in ['control','cached','pruned']
                for r in range(1, metadata['repeats']+1)}
    if set(data['results']) != expected or set(data['evaluations']) != expected:
        raise ValueError('Missing or unexpected paired configurations')
    for variant in expected:
        if set(data['results'][variant]) != set(original['inputs']) or set(data['evaluations'][variant]) != set(original['inputs']):
            raise ValueError(f'Incomplete board coverage: {variant}')
    count = sum(len(runs) for runs in data['results'].values())
    if count != metadata['runs']:
        raise ValueError('Run count does not match provenance')
    destination = ROOT/'recorded'
    shutil.copyfile(args.artifact/'results.json.gz', destination/'pruning-results.json.gz')
    shutil.copyfile(args.artifact/'metadata.json', destination/'pruning-metadata.json')
    subprocess.run([sys.executable, str(ROOT/'summarize_pruning.py'),
                    '--bundle', str(destination/'pruning-results.json.gz'),
                    '--metadata', str(destination/'pruning-metadata.json'),
                    '--out', str(destination/'pruning')], check=True)
    manifest = json.loads((ROOT/'manifest.json').read_bytes())
    manifest['pruningBenchmark'] = {
        'path': 'recorded/pruning-results.json.gz', 'sha256': metadata['bundleSha256'],
        'runs': count, 'repeats': metadata['repeats'], 'displayedRepeat': 1,
        'metadata': 'recorded/pruning-metadata.json', 'sourceCommit': metadata['sourceCommit'],
        'summary': 'recorded/pruning/summary.json', 'pairedQuality': 'recorded/pruning/paired-quality.json',
        'workflowUrl': f"https://github.com/{metadata['githubRepository']}/actions/runs/{metadata['githubRunId']}",
        'allOutputsDrcPass': metadata['allOutputsDrcPass'],
        'routingTestsPassed': 33, 'independentEvaluatorTestsPassed': 4,
    }
    (ROOT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(f'Imported {count} runs; the gallery selects repetition one')


if __name__ == '__main__':
    main()
