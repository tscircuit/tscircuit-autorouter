from pathlib import Path
import json, shutil, subprocess

experiment = Path('experiments/e2e-samples-20261120')
destination = experiment / 'fixed-copper-results'
destination.mkdir(exist_ok=True)
reference = Path('reference') / experiment / 'preserve-results' / 'before'
rows = []
for capture in sorted(Path('captures').glob('*/after/*')):
    sample = capture.name
    subprocess.run(['bun', str(experiment / 'audit-diagnostics.ts'), str(capture)], check=True)
    row = {'sample': sample}
    for variant, folder in [('before', reference / sample), ('after', capture)]:
        target = destination / variant / sample
        target.mkdir(parents=True, exist_ok=True)
        for name in ['report.json', 'process.json', 'assessment.json', 'diagnostics.json', 'pcb.svg']:
            shutil.copyfile(folder / name, target / name)
        result = {name: json.loads((folder / (name + '.json')).read_text()) for name in ['report', 'process', 'assessment', 'diagnostics']}
        assessment = result['assessment']
        report = result['report']
        assert not assessment['membershipErrors'], (sample, variant, 'Changed net membership')
        assert assessment['components'] == assessment['expectedComponents'], (sample, variant, 'Missing components')
        assert assessment['pads'] == assessment['expectedPads'], (sample, variant, 'Missing pads')
        assert report['initialCopper'] == 0, (sample, variant, 'Routed input copper')
        assert report['revisions']['@tscircuit/fanout-solver'] == '0.0.93'
        assert report['revisions']['variant'] == variant
        assert report['revisions']['router'] == {'before':'2b1207ad70971f326166b134ea19418137273f23','after':'f9c08dcd41bfd84beb0b17bdf8b75215a4701ac6'}[variant]
        row[variant] = result
    assert row['before']['report']['revisions']['coreLockSha256'] == row['after']['report']['revisions']['coreLockSha256'], (sample, 'Changed Core dependencies')
    rows.append(row)
assert len(rows) == 10, f'Expected ten boards, got {len(rows)}'
(destination / 'summary.json').write_text(json.dumps(rows, indent=2) + '\n')

def completed(result):
    report = result['report']
    assessment = result['assessment']
    return report['status'] == 'completed' and report['renderCompleted'] and assessment['requestedNets'] == assessment['connectedNets'] and not any(assessment['drc'].values())

statistics = {}
for variant in ['before', 'after']:
    results = [row[variant] for row in rows]
    statistics[variant] = {
        'completeBoards': sum(completed(result) for result in results),
        'requestedNets': sum(result['assessment']['requestedNets'] for result in results),
        'connectedNets': sum(result['assessment']['connectedNets'] for result in results),
        'emittedVias': sum(result['assessment']['vias'] for result in results),
        'copperDrcFindings': sum(sum(result['assessment']['drc'].values()) for result in results),
    }
(destination / 'statistics.json').write_text(json.dumps(statistics, indent=2) + '\n')
print('FIXED_COPPER_STATISTICS', json.dumps(statistics))
