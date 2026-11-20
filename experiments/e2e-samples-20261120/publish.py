from pathlib import Path
import gzip,json,shutil,subprocess

experiment=Path('experiments/e2e-samples-20261120')
destination=experiment/'results'
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
        row[variant]={name:json.loads((capture/(name+'.json')).read_text()) for name in ['report','process','assessment','diagnostics'] if (capture/(name+'.json')).exists()}
    rows.append(row)
assert len(rows)==10, f'Expected ten matched pairs, got {len(rows)}'
(destination/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')

def first_diagnostic(result):
    return next((entry for entry in result['diagnostics'] if entry.get('available')),None)

def diagnostic_label(result):
    entry=first_diagnostic(result)
    if not entry:return 'Fanout budget; no completed assignment' if result['diagnostics'] else 'Breakout placement failed'
    suffix=' (budget)' if any('budget exhausted' in error for error in result['report']['errors']) else ''
    return f"{entry['component']} {entry['routed']}/{entry['requested']}"+suffix

def completed(result):
    report=result['report'];assessment=result.get('assessment')
    return bool(assessment and report['status']=='completed' and report['renderCompleted'] and assessment['requestedNets']==assessment['connectedNets'] and not any(assessment['drc'].values()))

def phase_label(result):
    errors=result['report']['errors']
    placement=[error for error in errors if 'declared breakout edges need' in error]
    entry=first_diagnostic(result)
    if not entry and placement:return placement[0].split(' The connections')[0]
    if entry:return 'Fanout search budget' if any('budget exhausted' in error for error in errors) else 'Fanout incomplete'
    return errors[0] if errors else result['report']['status']

before_completed=sum(completed(row['before']) for row in rows)
after_completed=sum(completed(row['after']) for row in rows)
lines=[
    '# Uploaded full-circuit routing: 20 November 2026',
    '',
    f'Whole-board completion: **{before_completed}/10 before → {after_completed}/10 after**. A complete board must finish rendering, physically connect every multi-terminal net and pass the recorded copper checks. The source-turn change improves legal package escapes; it does not establish a full-board routing improvement.',
    '',
    '## Inputs and execution',
    '',
    'These ten uploaded TSX circuits replace the older board set. There are 2,856 multi-terminal nets across the ten circuits, including DDR, peripheral signals and power. Every run starts with zero traces and vias. Sources are verified against the uploaded ZIP SHA-256 `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`.',
    '',
    'Pinned revisions: core `4306536282fe5abf32c1395e106f55a5d61ca7a3`, autorouter `2b1207ad70971f326166b134ea19418137273f23`, merged fanout `9e771f68dca591642fca3b97187e14404c16c5aa`, bus-lanes 0.0.62, Bun 1.4.3. Candidate source hashes are in [candidate.json](../candidate.json). The benchmark checks out the final PR commit and verifies every changed library file by SHA-256.',
    '',
    'Each matched pair runs serially on one Blacksmith 8-vCPU ARM machine with the same installed dependencies and a 600-second routing budget (660-second hard process limit). Original samples run before→after; spaced samples run after→before. Instrumentation and physical audits are identical on both sides. Wall times include capture overhead and are not uninstrumented solver latency measurements.',
    '',
    'The uploaded original helpers disable fanout by default; the spaced helpers do not implement it. The unchanged-default control cohort is recorded separately below. The measured comparison uses [correct-workflow.tsx](../correct-workflow.tsx) to request fanout → DDR bus lanes → remaining signals/power. Native pad placement, net membership, nominal widths and DDR geometry are retained. Spaced escape widths come from the paired original’s explicit escape widths. Hashes and geometry checks are in [inputs.json](../inputs.json), [electrical-equivalence.json](../electrical-equivalence.json) and [workflow-geometry-check.json](../workflow-geometry-check.json).',
    '',
    'The spaced files also remove original copper pours and split the remaining routing phases. Differences between original and spaced boards cannot be attributed solely to peripheral spacing. No pours are invented for the spaced files.',
    '',
    '## Matched full-circuit results',
    '',
    '**Escapes are diagnostic terminal-to-boundary paths, not connected electrical nets.** A terminal may share its electrical net with other terminals. Failed fanout copper is not committed to the PCB. Budgeted rows show the last captured best completed assignment, not a completed search or a transient progress counter.',
    '',
    '| Circuit | Before escapes | After escapes | Diagnostic vias before→after | Emitted connected nets before→after | Copper DRC findings before→after | Seconds before→after |',
    '|---|---|---|---|---|---|---|',
]
for row in rows:
    before=row['before'];after=row['after'];b=first_diagnostic(before);a=first_diagnostic(after)
    vias=f"{b['vias']}→{a['vias']}" if b and a else '—'
    nets=f"{before['assessment']['connectedNets']}→{after['assessment']['connectedNets']}/{after['assessment']['requestedNets']}"
    drc=f"{sum(before['assessment']['drc'].values())}→{sum(after['assessment']['drc'].values())}"
    seconds=f"{before['report']['elapsedMs']/1000:.1f}→{after['report']['elapsedMs']/1000:.1f}"
    lines.append(f"| {row['sample']} | {diagnostic_label(before)} | {diagnostic_label(after)} | {vias} | {nets} | {drc} | {seconds} |")
lines += ['', 'Connected nets with zero emitted traces are connected by freshly generated physical copper pours. They are not newly autorouted nets. Diagnostic copper is separately clearance-checked in each diagnostics.json; zero emitted-copper DRC findings alone do not validate diagnostic routes.', '', '## Where the pipeline stops', '', '| Circuit | First blocker after the fix |', '|---|---|']
for row in rows:lines.append(f"| {row['sample']} | {phase_label(row['after'])} |")
lines += [
    '',
    'The captures include every FanoutSolver input, each autorouting phase SRJ, solver stage transitions, bounded stage-parameter descriptions, and periodic best attempts/child failure states. The complete replay data remains in [the matched benchmark artifacts](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44732068168). Nine cases encounter fanout failure or budget exhaustion. Glider spaced fails implicit winding-breakout placement before FanoutSolver; it subsequently attempts a DDR phase without the intended escapes. That is a separate pipeline-gating issue, not successful fanout.',
    '',
    'i.MX6 U10 has a physical obstruction under the supplied rules. Seven requested pins have a closed ring of neighboring 0.25mm pads on 0.5mm pitch. With a 0.12mm trace and 0.119mm clearance, the centerline exclusion radius is 0.304mm. A 0.4mm via needs 0.444mm separation from each foreign pad; the remaining interior via-center region stays within 0.084972mm of the source, inside its 0.125mm pad radius. It cannot escape without changing those rules or permitting a via in its pad. [Geometry measurements](../emmc-geometry-evidence.json) record both this obstruction and the contrasting legal iCE/Pi corridor.',
    '',
    '## Selected fix and rejected experiments',
    '',
    'The actionable geometry defect is a legal immediate 45-degree turn between mixed-width pads. The existing source prefix extends too far into the next pad and the candidate list omits the gap midpoint. The fix extends the existing candidate generation and plan construction: preserve the entire original bus search, then try source-origin connectors with midpoint tracks only when that search finds no plan. The existing isolated layer probe stays unchanged so a newly feasible top-layer turn cannot crowd out a previously successful bounded assignment. Width, clearance, atomic bus behavior and the no-via-in-pad rule stay enforced. Production changes are +41/−2 in four files, including the internal flag that preserves isolated layer screening.',
    '',
    'Midpoint candidates alone and source-origin connectors alone each leave captured U22 at 9/32. Their combination reaches 14/32 with 6 diagnostic vias instead of 8 and zero clearance errors. Trying that combination before all original bus alternatives regresses fresh spaced U2 from 76/92 to 75/92 and adds a via; that ordering was rejected. The revised ordering reaches 77/92 with the original 37 vias and loses no baseline connection identities in either captured iCE/Pi case. A second rejected revision changed isolated layer discovery and broke an existing 18-layer fixture with a one-assignment budget; preserving the original probe restores its exact baseline output.',
    '',
    'The narrow geometric fix is justified by a previously impossible-to-find valid zero-via escape and a small production diff. These results do not justify claiming whole-board completion or a timing improvement. Higher-impact remaining work includes breakout-edge capacity/placement, fanout layer-assignment cost, and bus/peripheral pathfinding. The i.MX6 obstruction must be addressed as an input/design-rule decision rather than by weakening clearance silently.',
    '',
    'Repro and naturally updated before/after SVGs: [repro #328](https://github.com/tscircuit/fanout-solver/pull/328), [stacked fix #329](https://github.com/tscircuit/fanout-solver/pull/329).',
    '',
    '## Unchanged-default controls',
    '',
    'These runs use each uploaded default exactly as authored. Fanout is disabled. They expose later pipeline failures but do not represent the requested fanout-first workflow. [Raw audits](../baseline-audited.json.gz); [control artifacts](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44722526398).',
    '',
    '| Circuit | Physical connected nets | Emitted traces / vias | Copper DRC findings | Last observed stage |',
    '|---|---|---|---|---|',
]
for row in json.loads(gzip.decompress((experiment/'baseline-audited.json.gz').read_bytes())):
    if row['mode']!='controls':continue
    assessment=row.get('assessment');solvers=row['report'].get('solvers',[])
    stage=solvers[-1]['phases'][-1]['stage'] if solvers and solvers[-1]['phases'] else '—'
    if assessment:
        nets=f"{assessment['connectedNets']}/{assessment['requestedNets']}";copper=f"{assessment['traces']} / {assessment['vias']}";drc=str(sum(assessment['drc'].values()))
    else:nets='N/A: hard process timeout';copper='N/A';drc='N/A'
    lines.append(f"| {row['sample']} | {nets} | {copper} | {drc} | {stage} |")
lines += ['', '## PCB SVGs', '', 'These are the actual emitted PCB results. Failed fanout attempts are intentionally absent from committed PCB copper; use the PR’s native diagnostic views to inspect those attempts. Neither an unrouted board nor a partial result is presented as a solved PCB.', '', '| Circuit | Before PCB | After PCB |', '|---|---|---|']
for row in rows:
    sample=row['sample'];lines.append(f'| {sample} | [SVG](before/{sample}/pcb.svg) | [SVG](after/{sample}/pcb.svg) |')
(destination/'analysis.md').write_text('\n'.join(lines)+'\n')
print('E2E_PUBLICATION',json.dumps({'completedBefore':before_completed,'completedAfter':after_completed,'rows':[{'sample':row['sample'],'before':diagnostic_label(row['before']),'after':diagnostic_label(row['after'])} for row in rows]}))
