"""Summarize the checksum-verified paired Blacksmith recording, without routing."""
import argparse
import csv
import gzip
import hashlib
import json
import math
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    payload = args.bundle.read_bytes()
    metadata = json.loads(args.metadata.read_bytes())
    if hashlib.sha256(payload).hexdigest() != metadata['bundleSha256']:
        raise ValueError('Benchmark bundle checksum mismatch')
    data = json.loads(gzip.decompress(payload))
    if sum(len(runs) for runs in data['results'].values()) != metadata['runs']:
        raise ValueError('Benchmark run count mismatch')
    args.out.mkdir(parents=True, exist_ok=True)
    rows = []
    bases = sorted(v[:-8] for v in data['results'] if v.endswith('-control'))
    summaries = []
    for base in bases:
        for mode in ['control', 'cached', 'pruned']:
            summary = {'configuration': base, 'mode': mode, 'byRepeat': []}
            wall = []
            for repeat in range(1, metadata['repeats']+1):
                variant = f'{base}-{mode}' + (f'-r{repeat}' if repeat > 1 else '')
                metrics = data['evaluations'][variant]
                if set(metrics) != set(data['inputs']):
                    raise ValueError(f'Incomplete benchmark configuration: {variant}')
                expanded = 0
                for sample, metric in metrics.items():
                    exp = data['results'][variant][sample]['experiment']
                    expanded += exp['breakoutStats']['totalExpandedStates']
                    wall.append(exp['processWallMs']/1000)
                    rows.append({'configuration': base, 'mode': mode, 'repeat': repeat, 'sample': sample,
                                 'connected': metric['physicallyConnected'], 'required': metric['routeRequiredConnections'],
                                 'completeClean': metric['fullyConnected'] and metric['drcPass'],
                                 'drcPass': metric['drcPass'], 'vias': metric['viaCount'],
                                 'traceLengthMm': metric['traceLengthMm'], 'expandedStates': exp['breakoutStats']['totalExpandedStates'],
                                 'wallSeconds': exp['processWallMs']/1000, 'solverSeconds': exp['elapsedMs']/1000,
                                 **exp['searchStats']})
                summary['byRepeat'].append({'repeat': repeat,
                    'connected': sum(m['physicallyConnected'] for m in metrics.values()),
                    'required': sum(m['routeRequiredConnections'] for m in metrics.values()),
                    'completeCleanBoards': sum(m['fullyConnected'] and m['drcPass'] for m in metrics.values()),
                    'vias': sum(m['viaCount'] for m in metrics.values()), 'expandedStates': expanded,
                    'timeLimitedBoards': sum(m['solverStatus'] == 'time_limit' for m in metrics.values())})
            summary['medianWallSeconds'] = statistics.median(wall)
            summaries.append(summary)
    pairs = []
    for base in bases:
        for mode in ['cached', 'pruned']:
            match = {'configuration': base, 'mode': mode, 'commonCompletedNets': 0,
                     'controlVias': 0, 'otherVias': 0, 'controlLengthMm': 0, 'otherLengthMm': 0}
            ratios, control_states, other_states, uncapped = [], 0, 0, []
            exact_cached_pairs = 0
            for repeat in range(1, metadata['repeats']+1):
                suffix = f'-r{repeat}' if repeat > 1 else ''
                a, b = f'{base}-control{suffix}', f'{base}-{mode}{suffix}'
                for sample in data['inputs']:
                    left, right = data['evaluations'][a][sample], data['evaluations'][b][sample]
                    nets_a = {n['net']: n for n in left['electricalNets'] if n['connected'] and not n['netHasShort']}
                    nets_b = {n['net']: n for n in right['electricalNets'] if n['connected'] and not n['netHasShort']}
                    for net in nets_a.keys() & nets_b.keys():
                        match['commonCompletedNets'] += 1
                        match['controlVias'] += nets_a[net]['viaCount']; match['otherVias'] += nets_b[net]['viaCount']
                        match['controlLengthMm'] += nets_a[net]['traceLengthMm']; match['otherLengthMm'] += nets_b[net]['traceLengthMm']
                    coverage_a = {(c['name'], c['connected']) for c in left['connections']}
                    coverage_b = {(c['name'], c['connected']) for c in right['connections']}
                    if left['solverStatus'] != 'time_limit' and right['solverStatus'] != 'time_limit' and coverage_a == coverage_b:
                        exp_a, exp_b = data['results'][a][sample]['experiment'], data['results'][b][sample]['experiment']
                        if mode == 'cached':
                            if data['results'][a][sample]['traces'] != data['results'][b][sample]['traces']:
                                raise ValueError(f'Cached mode changed an uncapped path: {base}/{sample}/r{repeat}')
                            exact_cached_pairs += 1
                        ratios.append(exp_b['processWallMs']/exp_a['processWallMs'])
                        control_states += exp_a['breakoutStats']['totalExpandedStates']
                        other_states += exp_b['breakoutStats']['totalExpandedStates']
                        uncapped.append({'sample': sample, 'repeat': repeat,
                                         'runtimeRatio': ratios[-1], 'controlStates': exp_a['breakoutStats']['totalExpandedStates'],
                                         'otherStates': exp_b['breakoutStats']['totalExpandedStates']})
            match.update({'uncappedIdenticalCoveragePairs': len(ratios),
                          'uncappedCachedExactPathPairs': exact_cached_pairs if mode == 'cached' else None,
                          'uncappedRuntimeGeomeanRatio': math.exp(statistics.mean(math.log(r) for r in ratios)) if ratios else None,
                          'uncappedControlExpandedStates': control_states, 'uncappedOtherExpandedStates': other_states,
                          'uncappedPairs': uncapped})
            pairs.append(match)
    (args.out/'summary.json').write_text(json.dumps(summaries, indent=2))
    (args.out/'paired-quality.json').write_text(json.dumps(pairs, indent=2))
    cache_pairs = []
    for base in bases:
        ratios, control_states, other_states = [], 0, 0
        common, cache_vias, pruned_vias = 0, 0, 0
        for repeat in range(1, metadata['repeats']+1):
            suffix = f'-r{repeat}' if repeat > 1 else ''
            a, b = f'{base}-cached{suffix}', f'{base}-pruned{suffix}'
            for sample in data['inputs']:
                left, right = data['evaluations'][a][sample], data['evaluations'][b][sample]
                nets_a = {n['net']: n for n in left['electricalNets'] if n['connected'] and not n['netHasShort']}
                nets_b = {n['net']: n for n in right['electricalNets'] if n['connected'] and not n['netHasShort']}
                for net in nets_a.keys() & nets_b.keys():
                    common += 1; cache_vias += nets_a[net]['viaCount']; pruned_vias += nets_b[net]['viaCount']
                if left['solverStatus'] != 'time_limit' and right['solverStatus'] != 'time_limit' and {(c['name'],c['connected']) for c in left['connections']} == {(c['name'],c['connected']) for c in right['connections']}:
                    exp_a, exp_b = data['results'][a][sample]['experiment'], data['results'][b][sample]['experiment']
                    ratios.append(exp_b['processWallMs']/exp_a['processWallMs'])
                    control_states += exp_a['breakoutStats']['totalExpandedStates']; other_states += exp_b['breakoutStats']['totalExpandedStates']
        cache_pairs.append({'configuration': base, 'uncappedIdenticalCoveragePairs': len(ratios),
                            'prunedOverCachedRuntimeGeomean': math.exp(statistics.mean(math.log(r) for r in ratios)) if ratios else None,
                            'cachedExpandedStates': control_states, 'prunedExpandedStates': other_states,
                            'commonCompletedNetComparisons': common, 'cachedVias': cache_vias, 'prunedVias': pruned_vias})
    (args.out/'pruned-vs-cached.json').write_text(json.dumps(cache_pairs, indent=2))
    with (args.out/'runs.csv').open('w') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
    print(json.dumps({'runs': len(rows), 'allDrcPass': all(row['drcPass'] for row in rows),
                      'sourceCommit': metadata['sourceCommit']}, indent=2))


if __name__ == '__main__':
    main()
