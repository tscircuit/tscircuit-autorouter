"""Restore recorded SRJ inputs, routed outputs and evaluations without rerouting."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_recording():
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
    print(f'Restored 16 inputs and 144 outputs under {args.out}')


if __name__ == '__main__':
    main()
