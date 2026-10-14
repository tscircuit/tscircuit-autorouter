"""Paired, fresh-process SRJ18 runs. Execute on Blacksmith, not a developer host."""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import math
import os
import platform
import statistics
import subprocess
import time
from pathlib import Path
from materialize import load_recording
from evaluate import evaluate

ROOT = Path(__file__).resolve().parent
CONFIGS = [('hex-p020', 'hex', .2), ('oct-p020', 'oct', .2),
           ('oct-density020', 'oct', .2 * math.sqrt(math.sqrt(3)/2)),
           ('hex-p010', 'hex', .1), ('oct-density010', 'oct', .1 * math.sqrt(math.sqrt(3)/2))]
MODES = [('control', 'off'), ('cached', 'cached'), ('pruned', 'regions')]


def evaluate_run(task):
    variant, sample, source, path = task
    data = json.loads(Path(path).read_bytes())
    metrics = evaluate(json.loads(source), data)
    metrics.update({'sample': sample, 'variant': variant})
    metrics['evaluationProvenance'] = {
        'inputSha256': hashlib.sha256(source.encode()).hexdigest(),
        'resultSha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        'evaluatorSha256': hashlib.sha256((ROOT/'evaluate.py').read_bytes()).hexdigest(),
        'clearanceMm': .1, 'defaultViaDiameterMm': .3,
    }
    return variant, sample, metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=ROOT/'work/pruning-benchmark')
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--repeats', type=int, default=2)
    parser.add_argument('--time-limit', type=float, default=60)
    args = parser.parse_args()
    if not os.environ.get('BLACKSMITH_PRUNING_BENCHMARK'):
        raise RuntimeError('Set BLACKSMITH_PRUNING_BENCHMARK only inside the documented Blacksmith job')
    if args.workers < 1 or args.repeats < 1 or args.time_limit <= 0:
        raise ValueError('Positive workers, repeats and time limit required')
    args.out.mkdir(parents=True, exist_ok=True)
    recording = load_recording()
    cpus = sorted(os.sched_getaffinity(0))
    if len(cpus) < args.workers:
        raise RuntimeError('Each benchmark lane requires its own available CPU')
    inputs = args.out/'inputs'
    inputs.mkdir(exist_ok=True)
    for sample, source in recording['inputs'].items():
        (inputs/f'{sample}.json').write_text(source)
    metadata = {
        'protocol': 'all five pitches; fresh processes; two counterbalanced repetitions; fixed CPU per lane; 60-second caps',
        'startedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'host': platform.uname()._asdict(), 'availableCpus': cpus,
        'workers': args.workers, 'repeats': args.repeats, 'timeLimit': args.time_limit,
        'githubRunId': os.environ.get('GITHUB_RUN_ID'), 'githubRepository': os.environ.get('GITHUB_REPOSITORY'),
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'bunVersion': subprocess.check_output(['bun', '--version'], text=True).strip(),
        'sourceHashes': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                         for path in sorted((ROOT/'src').glob('*.ts'))},
        'inputHashes': {sample: hashlib.sha256(source.encode()).hexdigest() for sample, source in recording['inputs'].items()},
    }
    (args.out/'metadata.json').write_text(json.dumps(metadata, indent=2))
    pairs = [(sample, config) for sample in sorted(recording['inputs']) for config in CONFIGS]
    # Fixed lane assignments avoid two timed children sharing an assigned CPU.
    lanes = [pairs[index::args.workers] for index in range(args.workers)]

    def run_lane(lane_index):
        outputs = []
        for sample, (name, grid, pitch) in lanes[lane_index]:
            for repeat in range(1, args.repeats + 1):
                order = MODES if (repeat + int(sample[-3:])) % 2 else list(reversed(MODES))
                for label, mode in order:
                    variant = f'{name}-{label}' + (f'-r{repeat}' if repeat > 1 else '')
                    directory = args.out/'results'/variant
                    directory.mkdir(parents=True, exist_ok=True)
                    path = directory/f'{sample}.json'
                    command = ['taskset', '-c', str(cpus[lane_index]), 'bun', str(ROOT/'src/gridRouter.ts'),
                               str(inputs/f'{sample}.json'), '--grid', grid, '--pitch', str(pitch),
                               '--layer-pruning', mode, '--time-limit', str(args.time_limit), '--out', str(path)]
                    started = time.perf_counter()
                    process = subprocess.run(command, capture_output=True, text=True, timeout=args.time_limit + 30, check=True)
                    wall_ms = (time.perf_counter() - started) * 1000
                    routed = json.loads(path.read_bytes())
                    routed['experiment'].update({'processWallMs': wall_ms, 'suiteConcurrency': args.workers,
                                                  'repeat': repeat, 'cpu': cpus[lane_index], 'benchmarkMode': label})
                    path.write_text(json.dumps(routed, separators=(',', ':')))
                    path.with_suffix('.log').write_text(process.stdout + process.stderr)
                    outputs.append((variant, sample, recording['inputs'][sample], str(path)))
                    print(variant, sample, routed['experiment']['status'], round(wall_ms), flush=True)
        return outputs

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        tasks = [task for outputs in pool.map(run_lane, range(args.workers)) for task in outputs]
    results, evaluations, rows = {}, {}, []
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        for variant, sample, metric in pool.map(evaluate_run, tasks):
            path = args.out/'results'/variant/f'{sample}.json'
            routed = json.loads(path.read_bytes())
            results.setdefault(variant, {})[sample] = {'traces': routed['traces'], 'experiment': routed['experiment']}
            evaluations.setdefault(variant, {})[sample] = metric
            exp = routed['experiment']
            rows.append({**{k: v for k, v in metric.items() if not isinstance(v, (dict, list))},
                         'expandedStates': exp['breakoutStats']['totalExpandedStates'],
                         'wallMs': exp['processWallMs'], 'repeat': exp['repeat'],
                         **exp['searchStats']})
            print('evaluated', variant, sample, metric['physicallyConnected'], metric['drcPass'], flush=True)
    payload = gzip.compress(json.dumps({'inputs': recording['inputs'], 'results': results,
                                       'evaluations': evaluations}, separators=(',', ':')).encode(), mtime=0)
    (args.out/'results.json.gz').write_bytes(payload)
    (args.out/'runs.json').write_text(json.dumps(rows, indent=2))
    metadata.update({'finishedUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                     'runs': len(rows), 'bundleSha256': hashlib.sha256(payload).hexdigest(),
                     'allOutputsDrcPass': all(row['drcPass'] for row in rows)})
    (args.out/'metadata.json').write_text(json.dumps(metadata, indent=2))
    summary = []
    for name, _, _ in CONFIGS:
        for label, _ in MODES:
            group = [row for row in rows if row['variant'] == f'{name}-{label}' or row['variant'].startswith(f'{name}-{label}-r')]
            summary.append({'configuration': name, 'mode': label, 'runs': len(group),
                            'connectionsByRepeat': [sum(row['physicallyConnected'] for row in group if row['repeat'] == r)
                                                    for r in range(1, args.repeats + 1)],
                            'cleanCompleteBoardsByRepeat': [sum(row['fullyConnected'] and row['drcPass'] for row in group if row['repeat'] == r)
                                                          for r in range(1, args.repeats + 1)],
                            'viasByRepeat': [sum(row['viaCount'] for row in group if row['repeat'] == r)
                                             for r in range(1, args.repeats + 1)],
                            'expandedStatesByRepeat': [sum(row['expandedStates'] for row in group if row['repeat'] == r)
                                                      for r in range(1, args.repeats + 1)],
                            'medianWallSeconds': statistics.median(row['wallMs']/1000 for row in group),
                            'viaTransitionsPruned': sum(row['viaTransitionsPruned'] for row in group)})
    (args.out/'summary.json').write_text(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
