"""Restore recorded SRJ inputs, routed outputs and evaluations without rerouting."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_recording(include_pruning=True):
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    payload = (ROOT / 'recorded/results.json.gz').read_bytes()
    if hashlib.sha256(payload).hexdigest() != manifest['recordedBundle']['sha256']:
        raise ValueError('Recorded result bundle checksum does not match manifest')
    data = json.loads(gzip.decompress(payload))
    for sample in manifest['dataset']['samples']:
        actual = hashlib.sha256(data['inputs'][sample['sample']].encode()).hexdigest()
        if actual != sample['sha256']:
            raise ValueError(f"Input checksum mismatch: {sample['sample']}")
    if len(data['inputs']) != 16 or sum(len(runs) for runs in data['results'].values()) != 144:
        raise ValueError('Expected exactly 16 inputs and 144 recorded outputs')
    if include_pruning and 'pruningBenchmark' in manifest:
        info = manifest['pruningBenchmark']
        payload = (ROOT/info['path']).read_bytes()
        if hashlib.sha256(payload).hexdigest() != info['sha256']:
            raise ValueError('Layer-pruning benchmark checksum mismatch')
        pruning = json.loads(gzip.decompress(payload))
        if pruning['inputs'] != data['inputs'] or sum(len(r) for r in pruning['results'].values()) != info['runs']:
            raise ValueError('Layer-pruning inputs or run count mismatch')
        # Images always show repetition one, never the most successful repetition.
        for variant, runs in pruning['results'].items():
            if any(variant.endswith(f'-r{r}') for r in range(2, info['repeats']+1)):
                continue
            if set(runs) != set(data['inputs']):
                raise ValueError(f'Incomplete pruning configuration: {variant}')
            data['results'][variant] = runs
            data['evaluations'][variant] = pruning['evaluations'][variant]
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=ROOT / 'work/recorded')
    args = parser.parse_args()
    data = load_recording()
    (args.out / 'inputs').mkdir(parents=True, exist_ok=True)
    for sample, text in data['inputs'].items():
        (args.out / 'inputs' / f'{sample}.json').write_text(text)
    for variant, runs in data['results'].items():
        result_directory = args.out / 'results' / variant
        evaluation_directory = args.out / 'evaluation' / variant
        result_directory.mkdir(parents=True, exist_ok=True)
        evaluation_directory.mkdir(parents=True, exist_ok=True)
        for sample, result in runs.items():
            output = {**json.loads(data['inputs'][sample]), **result}
            (result_directory / f'{sample}.json').write_text(json.dumps(output, indent=2))
            (evaluation_directory / f'{sample}.json').write_text(json.dumps(data['evaluations'][variant][sample], indent=2))
    count = sum(len(runs) for runs in data['results'].values())
    print(f'Restored 16 inputs and {count} displayed outputs under {args.out}')


if __name__ == '__main__':
    main()
