from pathlib import Path
import json, statistics

root = Path(__file__).resolve().parent

def read(relative):
    return json.loads((root / relative).read_text())

original = read('fanout31-original-matched.json')
original_independent = read('fanout31-original.json')
cleanup = read('fanout31-cleanup.json')
fix = read('fanout31-fix.json')
expected_commits = {
    'original': '693c4b54a5b369d6774bb6f82487cfe25730adf1',
    'cleanup': '519393298edc2c68f082f3575877d333a648e4d5',
    'fix': 'ce72347ac145d932370fab6346765b0422f54cfc',
}

def outcomes(cohort):
    return {row['sample']: {key: row.get(key) for key in ['status', 'routed', 'connections', 'vias', 'validatedBreakouts']} for row in cohort['report']['rows']}

assert original['inputs'] == original_independent['inputs']
assert original['svgs'] == original_independent['svgs']
assert outcomes(original) == outcomes(original_independent)

for label, cohort in [('original', original), ('cleanup', cleanup), ('fix', fix)]:
    assert cohort['report']['commit'] == expected_commits[label]
    assert len(cohort['inputs']) == len(cohort['report']['rows']) == 72
    assert len(cohort['svgs']) == 30
    assert cohort['inputs'] == original['inputs']
    assert cohort['svgs'] == original['svgs']
    assert outcomes(cohort) == outcomes(original)

pairs = {}
for board, routed in [('icepi', 7), ('imx6', 8)]:
    rows = read(f'{board}/comparison.json')
    original_native = json.loads((root.parent / f'paired/{board}/comparison.json').read_text())
    assert len(rows) == 6
    assert len({row['inputSha256'] for row in rows}) == 1
    assert len({row['copperSha256'] for row in rows}) == 1
    assert len({row['iterations'] for row in rows}) == 1
    assert rows[0]['inputSha256'] == original_native[0]['inputSha256']
    assert rows[0]['copperSha256'] == original_native[0]['copperSha256']
    assert all(row['failed'] and not row['solved'] for row in rows)
    assert all(row['bestPartial']['routed'] == routed for row in rows)
    assert all(row['copperDrc']['valid'] and not row['copperDrc']['issues'] and row['copperDrc']['checkedViaCount'] == 7 for row in rows)
    before = [row['elapsedMs'] for row in rows if row['revision'] == 'before']
    after = [row['elapsedMs'] for row in rows if row['revision'] == 'after']
    assert len(before) == len(after) == 3
    before_median = statistics.median(before)
    after_median = statistics.median(after)
    pairs[board] = {
        'beforeMs': before,
        'afterMs': after,
        'beforeMedianMs': before_median,
        'afterMedianMs': after_median,
        'medianReductionPercent': (1 - after_median / before_median) * 100,
        'inputSha256': rows[0]['inputSha256'],
        'copperSha256': rows[0]['copperSha256'],
        'iterations': rows[0]['iterations'],
        'bestPartialRouted': routed,
        'requestedConnections': 32,
        'throughVias': 7,
        'independentCopperDrcIssues': 0,
        'fullSolve': False,
    }

summary = {
    'commits': expected_commits,
    'libraryEquivalentPublishedCommit': 'e22a028893c2ad121c5b0e0ba2e9e998e680feb8',
    'runtime': {'bun': '1.4.3', 'nativeRunner': 'blacksmith-8vcpu-ubuntu-2404-arm', 'benchmarkRunner': 'blacksmith-32vcpu-ubuntu-2404-arm'},
    'structure': {'originalRouteBusLines': 4333, 'entrypointLines': 19, 'largestExtractedModuleLines': 388, 'cleanupChangedSnapshots': 0, 'fixAddedSourceLines': 3},
    'focused': {'beforeUnusedBoundaryLayouts': 1, 'afterUnusedBoundaryLayouts': 0, 'routeAndViaUnchanged': True},
    'nativePairedSearches': pairs,
    'fanout31': {'cases': 72, 'solved': 30, 'timeouts': 42, 'identicalInputsAndOutcomesAcrossOriginalCleanupAndFix': True, 'identicalSolvedSvgs': 30},
    'equivalence': {'cleanup': read('cleanup-equivalence.json'), 'fix': read('fix-equivalence.json')},
    'checks': {
        'originalBenchmark': 'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44415945774/job/135196147848',
        'matchedOriginalAndCleanup': 'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44421280119',
        'independentCleanupBenchmark': 'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44416992946/job/135199773899',
        'fixBenchmarkAndNativePairs': 'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44417208232',
    },
    'benchmarkControl': {
        'method': 'Original and cleanup run serially on one worker with the same 72 frozen inputs, concurrency 16 and 120-second deadlines.',
        'independentCleanupRun': {'solved': 10, 'timeouts': 62, 'report': 'fanout31-cleanup-unmatched.json'},
        'independentRunNote': 'The independent cleanup run underperformed. Same-worker probes did not reproduce that slowdown; its cause was not established. The matched full comparison is the source-equivalence control.',
    },
    'scope': 'Behavior-preserving route-bus cleanup and restacked native plane-layout optimization. Native joint fanout searches still fail with partial copper; this rerun does not claim completed full boards.',
}
(root / 'analysis.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'nativePairedSearches': pairs, 'fanout31': summary['fanout31']}, indent=2))
