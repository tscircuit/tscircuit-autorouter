from pathlib import Path
import json,shutil,subprocess,statistics

experiment=Path('experiments/e2e-samples-20261120')
destination=experiment/'core-results'
destination.mkdir(exist_ok=True)
rows=[]
for folder in sorted(Path('captures').glob('*/before/*')):
    sample=folder.name
    row={'sample':sample}
    for variant in ['before','after']:
        capture=folder.parent.parent/variant/sample
        subprocess.run(['bun',str(experiment/'audit-diagnostics.ts'),str(capture)],check=True)
        target=destination/variant/sample
        target.mkdir(parents=True,exist_ok=True)
        for name in ['report.json','process.json','assessment.json','diagnostics.json','pcb.svg']:
            if (capture/name).exists():shutil.copyfile(capture/name,target/name)
        result={name:json.loads((capture/(name+'.json')).read_text()) for name in ['report','process','assessment','diagnostics'] if (capture/(name+'.json')).exists()}
        assessment=result['assessment']
        assert not assessment['membershipErrors'], (sample,variant,'Changed net membership')
        assert assessment['components']==assessment['expectedComponents'], (sample,variant,'Missing components')
        assert assessment['pads']==assessment['expectedPads'], (sample,variant,'Missing pads')
        row[variant]=result
    rows.append(row)
assert len(rows)==10, f'Expected ten matched pairs, got {len(rows)}'
(destination/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')

def placement_errors(result):
    return list(dict.fromkeys(error for error in result['report']['errors'] if 'Winding fanout failed' in error))

def completed(result):
    report=result['report'];assessment=result['assessment']
    return report['status']=='completed' and report['renderCompleted'] and assessment['requestedNets']==assessment['connectedNets'] and not any(assessment['drc'].values())

def first_blocker(result):
    errors=placement_errors(result)
    if errors:return errors[0].split(' The connections')[0]
    if any('budget exhausted' in error for error in result['report']['errors']):return 'Fanout search budget exhausted'
    return result['report']['errors'][0].split(' The breakout boundary')[0] if result['report']['errors'] else result['report']['status']

times={variant:[row[variant]['report']['elapsedMs']/1000 for row in rows] for variant in ['before','after']}
medians={variant:statistics.median(values) for variant,values in times.items()}
p95={variant:statistics.quantiles(values,n=100,method='inclusive')[94] for variant,values in times.items()}
totals={variant:sum(values) for variant,values in times.items()}
def decrease(before,after):return (before-after)/before*100
stopped=[row for row in rows if placement_errors(row['after']) and row['before']['report']['solvers'] and not row['after']['report']['solvers']]
before_completed=sum(completed(row['before']) for row in rows)
after_completed=sum(completed(row['after']) for row in rows)
statistics_summary={'completedBefore':before_completed,'completedAfter':after_completed,'stoppedCases':[row['sample'] for row in stopped],'medianSeconds':medians,'p95Seconds':p95,'totalSeconds':totals,'medianReductionPercent':decrease(medians['before'],medians['after']),'p95ReductionPercent':decrease(p95['before'],p95['after']),'totalReductionPercent':decrease(totals['before'],totals['after'])}
(destination/'statistics.json').write_text(json.dumps(statistics_summary,indent=2)+'\n')
lines=[
    '# Uploaded full-circuit routing: 20 November 2026',
    '',
    f"Selected fix: stop routing when automatic fanout placement has left unresolved handoffs. The 11-line core change prevents routing from continuing on the original unsplit endpoints in **{len(stopped)}/10 circuits**. Whole-board completion remains **{before_completed}/10 → {after_completed}/10**.",
    '',
    f"Median wall time to return a failure or routing-budget result falls **{medians['before']:.1f}s → {medians['after']:.1f}s ({statistics_summary['medianReductionPercent']:.1f}% lower)**. These are failed/budgeted run times, including capture overhead. There are no completed boards from which to calculate time-to-solve P50/P95.",
    '',
    '## Matched results',
    '',
    '| Metric | Before | After | Change |',
    '|---|---|---|---|',
    f'| Complete boards | {before_completed}/10 | {after_completed}/10 | {after_completed-before_completed:+d} boards |',
    f"| Median failed/budgeted wall time | {medians['before']:.1f}s | {medians['after']:.1f}s | {statistics_summary['medianReductionPercent']:.1f}% lower |",
    f"| P95 failed/budgeted wall time | {p95['before']:.1f}s | {p95['after']:.1f}s | {statistics_summary['p95ReductionPercent']:.1f}% lower |",
    f"| Total paired-cohort wall time | {totals['before']:.1f}s | {totals['after']:.1f}s | {statistics_summary['totalReductionPercent']:.1f}% lower |",
    f'| Circuits entering routing after failed winding placement | {len(stopped)} | 0 | Prevented in {len(stopped)} circuits |',
    '',
    'A routing invocation below means an observed FanoutSolver, BusLanesPipelineSolver or generic autorouter instance. Placement solvers still run to produce the original diagnostic. Connected nets count physical continuity through emitted copper and actual pours; diagnostic partial fanout attempts do not count. Singleton nets are excluded.',
    '',
    '| Circuit | Routing invocations before→after | Seconds before→after | Time reduction | Connected nets before→after / requested | Emitted vias before→after | Copper DRC findings before→after |',
    '|---|---|---|---|---|---|---|',
]
for row in rows:
    before=row['before'];after=row['after'];b=before['assessment'];a=after['assessment'];bt=before['report']['elapsedMs']/1000;at=after['report']['elapsedMs']/1000
    lines.append(f"| {row['sample']} | {len(before['report']['solvers'])}→{len(after['report']['solvers'])} | {bt:.1f}→{at:.1f} | {decrease(bt,at):.1f}% | {b['connectedNets']}→{a['connectedNets']} / {a['requestedNets']} | {b['vias']}→{a['vias']} | {sum(b['drc'].values())}→{sum(a['drc'].values())} |")
lines += [
    '',
    'All emitted traces/vias and connected-net details are in each report and assessment. Nets connected while the trace count is zero are connected by freshly generated physical pours. The fix preserves errors from placement and avoids spending the routing budget on a topology missing its required handoffs.',
    '',
    '## Pipeline interception and first blockers',
    '',
    'Every run captures constructor SRJs, autorouting phase SRJs, stage transitions and parameter summaries, periodic best assignments and active child failure states. Inputs were replayed independently to distinguish missing legal candidates from physical obstruction. Full captures remain in [the benchmark artifacts](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44735325252).',
    '',
    '| Circuit | First remaining blocker |',
    '|---|---|',
]
for row in rows:lines.append(f"| {row['sample']} | {first_blocker(row['after'])} |")
lines += [
    '',
    'The placement error was recorded before async routing started. Its automatic breakout points had no PCB identities, so no fanout handoffs entered the SRJ. Empty fanout phases were skipped, allowing subsequent solvers to work on unsplit connections. Group now checks the unresolved automatic points before starting async routing. Its selector stays inside the routing subcircuit; manual points and already resolved dogbone points continue through the existing path.',
    '',
    'The reported edge-capacity failures are failures of the current placement planner under its declared spacing and edge constraints. They are not proofs that those whole boards are physically unroutable. The next investigation should examine edge allocation, layer capacity and wire/via spacing, then the remaining fanout search budgets.',
    '',
    'i.MX6 U10 has a separate geometric obstruction: seven requested pads are enclosed by eight foreign pads. At even a 0.12mm wire width and 0.119mm clearance, 0.25mm pads on 0.5mm pitch form a closed centerline exclusion ring (radius 0.304mm). A 0.4mm via requires 0.444mm separation from each foreign pad, confining the interior via center to within 0.084972mm of its source, inside the source pad’s 0.125mm radius. The no-via-in-pad rule prevents that escape. [Measurements](../emmc-geometry-evidence.json).',
    '',
    '## Inputs and reproducibility',
    '',
    'The ten supplied TSX files replace the previous board set: original and spaced H616, ButterStick, Glider, i.MX6 and iCE/Pi. All DDR, peripheral and power connectivity is included: **2,856 multi-terminal nets**. The archive SHA-256 is `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`.',
    '',
    'Baseline core is `4306536282fe5abf32c1395e106f55a5d61ca7a3`; the candidate Group source is byte-identical to the fix PR and recorded in [core-candidate.json](../core-candidate.json). Autorouter stays `2b1207ad70971f326166b134ea19418137273f23`, fanout stays `9e771f68dca591642fca3b97187e14404c16c5aa`, bus-lanes stays 0.0.62, and Bun is 1.4.3. No source-turn change is included in this comparison.',
    '',
    'Each pair runs serially on one Blacksmith 8-vCPU ARM machine with the same installed dependencies, input hashes and rules, a 600-second routing budget and a 660-second process limit. Originals run before→after; spaced variants run after→before. Source fingerprints are checked before each run. Wall time includes identical instrumentation and is not a measure of uninstrumented solver latency. Zero newly emitted input traces/vias is verified; when the guard prevents any routing start, the final zero-copper result is checked instead.',
    '',
    'The original supplied helpers default fanout off; the spaced helpers lack standalone fanout support. [correct-workflow.tsx](../correct-workflow.tsx) enables the requested fanout → DDR bus lanes → remaining signals/power sequence. Native geometry, electrical membership and nominal widths are retained. Spaced escape widths come from the paired original’s explicit escape widths. [Input hashes](../inputs.json), [electrical equivalence](../electrical-equivalence.json), [geometry checks](../workflow-geometry-check.json).',
    '',
    'Spaced variants also omit original copper pours and split the remaining phases, so original-versus-spaced differences cannot be attributed only to peripheral spacing. Original pour intent is retained; no pours are invented for spaced boards. The unchanged-default control cohort and its later bus/peripheral failures are recorded in [the preceding analysis](https://github.com/tscircuit/tscircuit-autorouter/blob/analysis/e2e-results-20261120/experiments/e2e-samples-20261120/results/analysis.md#unchanged-default-controls).',
    '',
    '## Fix and experiment decision',
    '',
    '[Repro #5742](https://github.com/tscircuit/core/pull/5742) records the natural SVG before the guard. [Stacked fix #5743](https://github.com/tscircuit/core/pull/5743) updates that same SVG. The shallow case shows four actual bus routes bypassing an infeasible fanout before the fix, then preserves the original diagnostic and stops that bypass after the fix. The fix adds 11 production lines in one existing file.',
    '',
    'A source-turn/midpoint candidate was also measured and rejected: it improves the focused U22 diagnostic from 9/32 to 14/32 with fewer vias, but full-board completion stays 0/10, median failed/budgeted time rises 12.8%, Glider loses one diagnostic escape under the budget, and i.MX6 spaced adds two vias for one extra escape. Its two draft PRs were closed. [All ten measurements and SVGs for that rejected candidate](https://github.com/tscircuit/tscircuit-autorouter/blob/analysis/e2e-results-20261120/experiments/e2e-samples-20261120/results/analysis.md).',
    '',
    '## Actual PCB SVGs',
    '',
    'These are emitted PCB results, including incomplete boards. Failed fanout diagnostic copper is uncommitted and therefore absent from these PCBs. Board completion remains reported separately above.',
    '',
    '| Circuit | Before PCB | After PCB |',
    '|---|---|---|',
]
for row in rows:
    sample=row['sample'];lines.append(f'| {sample} | [SVG](before/{sample}/pcb.svg) | [SVG](after/{sample}/pcb.svg) |')
(destination/'analysis.md').write_text('\n'.join(lines)+'\n')
print('E2E_CORE_STATISTICS',json.dumps(statistics_summary))
