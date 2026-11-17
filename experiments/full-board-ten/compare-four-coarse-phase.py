"""Summarize a same-runner pair without treating graph progress as board completion."""
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
results = root / 'phase-results'
baseline = json.loads((results / 'source-baseline/result.json').read_text())
handoff = json.loads((results / 'handoff-only/result.json').read_text())
assert baseline['baselineQualified'] and baseline['diagnosticObservationValid']
assert handoff['diagnosticObservationValid']
for field in ['case', 'inputSha256', 'originalAutorouterSha256', 'limitsMs', 'constructor', 'packages']:
    assert baseline[field] == handoff[field], field
for result in [baseline, handoff]:
    assert not result['timedOut'] and not result['thrownError']
    assert result['wasmUsage']['routingOrUnknownAttempts'] == 0
    for field in ['configured', 'initial', 'inputNetCount', 'innerHookInstalled']:
        assert result['baselineContract'][field]['equal'], field

def summarize(result):
    observation = json.loads((results / result['variant'] / 'coarse-recovery-observation.json').read_text())
    assert not observation['observationErrors']
    return {
        'solved': result['solved'], 'failed': result['failed'], 'error': result['error'],
        'elapsedMs': result['elapsedMs'], 'pipelineIterations': result['iterations'],
        'highDensity': result['highDensity'], 'outputSummary': result['outputSummary'],
        'coarseAttempts': [{
            key: solver.get(key) for key in ['attempt', 'className', 'iterations', 'maxIterations',
                'solved', 'failed', 'error', 'ripCount', 'committedOwnerRouteCount', 'currentRouteId']
        } | {'pendingRouteCount': len(solver['pendingRouteIds'])} for solver in observation['solvers']],
    }

report = {
    'case': baseline['case']['id'], 'phase': baseline['case']['phase'],
    'inputSha256': baseline['inputSha256'], 'nativeBaselineQualified': True,
    'baseline': summarize(baseline), 'handoff': summarize(handoff),
    'phaseNewlySolved': not baseline['solved'] and handoff['solved'],
    'phaseRegressed': baseline['solved'] and not handoff['solved'],
    'interpretation': 'Native phase pair on the same runner, fresh processes and unchanged caps. Coarse owners and HD nodes are not physically connected board nets.',
}
(results / 'comparison.json').write_text(json.dumps(report, indent=2) + '\n')
print('COARSE_PHASE_COMPARISON ' + json.dumps(report))
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write(f"### {report['case']} / {report['phase']}\n\n")
        summary.write('| Variant | Phase solved | HD nodes accepted | Routing seconds |\n|---|---:|---:|---:|\n')
        for label in ['baseline', 'handoff']:
            row = report[label]
            accepted = row['highDensity']['acceptedNodeCount'] if row['highDensity'] else 0
            summary.write(f"| {label} | {row['solved']} | {accepted} | {row['elapsedMs']/1000:.2f} |\n")
        summary.write('\n' + report['interpretation'] + '\n')
