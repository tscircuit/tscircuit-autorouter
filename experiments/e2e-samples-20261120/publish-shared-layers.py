from pathlib import Path
import json, shutil, subprocess, statistics

experiment = Path('experiments/e2e-samples-20261120')
destination = experiment / 'shared-layer-results'
destination.mkdir(exist_ok=True)
rows = []
for folder in sorted(Path('captures').glob('*/before/*')):
    sample = folder.name
    row = {'sample': sample}
    for variant in ['before', 'after']:
        capture = folder.parent.parent / variant / sample
        subprocess.run(['bun', str(experiment / 'audit-diagnostics.ts'), str(capture)], check=True)
        target = destination / variant / sample
        target.mkdir(parents=True, exist_ok=True)
        for name in ['report.json', 'process.json', 'assessment.json', 'diagnostics.json', 'pcb.svg']:
            shutil.copyfile(capture / name, target / name)
        result = {name: json.loads((capture / (name + '.json')).read_text()) for name in ['report', 'process', 'assessment', 'diagnostics']}
        assessment = result['assessment']
        report = result['report']
        assert not assessment['membershipErrors'], (sample, variant, 'Changed net membership')
        assert assessment['components'] == assessment['expectedComponents'], (sample, variant, 'Missing components')
        assert assessment['pads'] == assessment['expectedPads'], (sample, variant, 'Missing pads')
        assert report['initialCopper'] == 0, (sample, variant, 'Routed input copper')
        assert report['revisions']['core'] == '351e73d665fad37577c47fcbff2e4c29eb377467'
        assert report['revisions']['@tscircuit/fanout-solver'] == '0.0.93'
        assert report['revisions']['variant'] == variant
        row[variant] = result
    assert row['before']['report']['revisions']['coreLockSha256'] == row['after']['report']['revisions']['coreLockSha256']
    rows.append(row)
assert len(rows) == 10, f'Expected ten matched pairs, got {len(rows)}'
(destination / 'summary.json').write_text(json.dumps(rows, indent=2) + '\n')

def completed(result):
    report = result['report']
    assessment = result['assessment']
    return report['status'] == 'completed' and report['renderCompleted'] and assessment['requestedNets'] == assessment['connectedNets'] and not any(assessment['drc'].values())

statistics_summary = {}
for variant in ['before', 'after']:
    results = [row[variant] for row in rows]
    seconds = [result['report']['elapsedMs'] / 1000 for result in results]
    statistics_summary[variant] = {
        'completeBoards': sum(completed(result) for result in results),
        'requestedNets': sum(result['assessment']['requestedNets'] for result in results),
        'connectedNets': sum(result['assessment']['connectedNets'] for result in results),
        'emittedVias': sum(result['assessment']['vias'] for result in results),
        'copperDrcFindings': sum(sum(result['assessment']['drc'].values()) for result in results),
        'circuitsWithPlacementErrors': sum(any('Winding fanout failed' in error for error in result['report']['errors']) for result in results),
        'medianFailedOrBudgetedSeconds': statistics.median(seconds),
        'p95FailedOrBudgetedSeconds': statistics.quantiles(seconds, n=100, method='inclusive')[94],
        'totalSeconds': sum(seconds),
    }
(destination / 'statistics.json').write_text(json.dumps(statistics_summary, indent=2) + '\n')
print('SHARED_LAYER_STATISTICS', json.dumps(statistics_summary))
