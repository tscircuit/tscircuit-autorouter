from pathlib import Path
from collections import Counter
import gzip,hashlib,html,json,re,shutil

ROOT=Path(__file__).resolve().parent
BOARDS={'orangecrab':'OrangeCrab rev 0.2.1 ECP5 DDR3','h616':'Allwinner H616 Devboard DDR3','butterstick':'ButterStick r1.0','glider':'Glider mainboard','imx6':'i.MX6 Demo Board','icepi':'iCE/Pi CM0 SBC'}
def read(path):
    return json.loads((ROOT/path).read_text())
def digest(raw):
    return hashlib.sha256(raw).hexdigest()
def board_result(phase,board):
    folder=Path(phase)/board
    plan=read(folder/'plan.json');progress=read(folder/'progress.json');diagnostics=read(folder/'diagnostics.json');assessment=read(folder/'assessment.json')
    state=diagnostics['fanoutLastState'];stats=state['stats']
    captured=gzip.decompress((ROOT/folder/'fanout-1-input.json.gz').read_bytes());request=json.loads(captured)
    matched=re.search(r'best layer assignment routed (\d+)/(\d+) connections',state['error'] or '')
    kinds=[entry['autorouter'] for entry in plan['plans']]
    first_rest=next(i for i,kind in enumerate(kinds) if kind!='fanout')
    assert all(kind=='fanout' for kind in kinds[:first_rest])
    bus_indexes=[i for i,kind in enumerate(kinds) if kind=='bus_lanes']
    assert all(first_rest<=i for i in bus_indexes)
    assert all(kind=='bus_lanes' for kind in kinds[first_rest:max(bus_indexes)+1])
    assert plan['initialCopperElements']==0
    return {
        'bestRouted':int(matched[1]) if matched else None,
        'requested':len(request['solverParams']['connections']),
        'lastReportedRouted':stats['routedConnections'],
        'lastReportedAssignment':stats['assignment'],
        'maxAssignments':stats['assignmentCount'],
        'searchFinished':state['failed'] or state['solved'],
        'fanoutSolved':state['solved'],'fanoutError':state['error'],
        'inputSha256':digest(captured),'sourceSha256':plan['sourceSha256'],
        'acceptedTraces':assessment['pcbTraces'],'acceptedVias':assessment['vias'],
        'connectedNets':assessment['connectedNets'],'routableNets':assessment['routableNets'],
        'geometryErrors':len(assessment['geometryErrors']),'membershipErrors':len(assessment['membershipErrors']),
        'physicalFindings':sum(count for kind,count in assessment['findings'].items() if kind!='routing'),
        'elapsedMs':progress['elapsedMs'],
        'fanoutElapsedMs':progress['phases'][0].get('elapsedMs'),
        'busPhasesStarted':sum(phase['solver']=='BusLanesSolver' for phase in progress['phases']),
        'plannedBusPhases':len(bus_indexes),'plannedFanoutRegions':kinds.count('fanout'),
        'phaseOrderVerified':True,'initialCopperElements':0,
    }

rows=[]
for board,title in BOARDS.items():
    before=board_result('before',board);after=board_result('after',board)
    assert before['inputSha256']==after['inputSha256'],board
    assert before['sourceSha256']==after['sourceSha256'],board
    assert before['requested']==after['requested'],board
    assert before['geometryErrors']==after['geometryErrors']==before['membershipErrors']==after['membershipErrors']==0
    rows.append({'board':board,'title':title,'before':before,'after':after})
finished=[row for row in rows if row['before']['searchFinished'] and row['after']['searchFinished']]
assert {row['board'] for row in finished}=={'butterstick','glider','imx6','icepi'}
total=sum(row['before']['requested'] for row in finished)
before_routed=sum(row['before']['bestRouted'] for row in finished);after_routed=sum(row['after']['bestRouted'] for row in finished)
missing_before=total-before_routed;missing_after=total-after_routed
primary={'scope':'Best first-fanout assignments on the four boards that exhausted their search in both runs: ButterStick, Glider, i.MX6, iCE/Pi. This is partial fanout, not connected whole-board nets.',
    'requested':total,'beforeRouted':before_routed,'afterRouted':after_routed,
    'beforeCompletionPercent':100*before_routed/total,'afterCompletionPercent':100*after_routed/total,
    'completionPercentagePoints':100*(after_routed-before_routed)/total,
    'beforeMissing':missing_before,'afterMissing':missing_after,'missingReductionPercent':100*(missing_before-missing_after)/missing_before}
bench_before=read('fanout31/before.json');bench_after=read('fanout31/after.json')
assert bench_before['totalSamples']==bench_after['totalSamples']==72
assert read('fanout31/before-input-checksums.json')==read('fanout31/after-input-checksums.json')
changes=[]
for before,after in zip(bench_before['rows'],bench_after['rows']):
    assert before['sample']==after['sample']
    if any(before[key]!=after[key] for key in ['status','routed','validatedBreakouts','vias']):
        changes.append({'before':before,'after':after})
fanout31={'before':dict(Counter(row['status'] for row in bench_before['rows'])),'after':dict(Counter(row['status'] for row in bench_after['rows'])),
    'changedOutcomeRows':changes,'all72InputsIdentical':True,'sampleTimeoutSeconds':120,'concurrency':32,
    'limitations':'43 cases time out in both runs. The comparison establishes unchanged observed outcomes, not that those cases complete successfully.'}
quality={phase:read(f'native-quality/{phase}/report.json') for phase in ['before','after']}
assert all(report['copperDrc']['valid'] for report in quality.values())
assert quality['after']['bestPartial']=={'routed':7,'planes':6,'boundary':1,'vias':7,'connectionNames':['breakout:pcb_breakout_point_6','source_trace_16','source_trace_3','source_trace_7','source_trace_15','source_trace_17','source_trace_18'],'planeBuses':['ESC_U22_pin6','ESC_U22_pin142','ESC_U22_pin65','ESC_U22_pin55','ESC_U22_pin73','ESC_U22_pin82']}
trials=[]
for trial,folder in [(1,'native'),(2,'native-quality')]:
    before=read(f'{folder}/before/report.json');after=read(f'{folder}/after/report.json')
    assert before['inputSha256']==after['inputSha256']==rows[-1]['before']['inputSha256']
    trials.append({'trial':trial,'beforeElapsedMs':before['elapsedMs'],'afterElapsedMs':after['elapsedMs'],'beforeRouted':1,'afterRouted':7})
native={'inputSha256':quality['after']['inputSha256'],'before':quality['before']['bestPartial'],'after':quality['after']['bestPartial'],
    'copperDrc':{phase:report['copperDrc'] for phase,report in quality.items()},'trials':trials,
    'identicalGraphicsAcrossRepeats':{phase:digest((ROOT/f'native/{phase}/fanout.graphics.json').read_bytes())==digest((ROOT/f'native-quality/{phase}/fanout.graphics.json').read_bytes()) for phase in ['before','after']},
    'acceptedByCore':False,'timingConclusion':'The two worker pairs vary in timing direction. No reliable runtime improvement is established. Routing counts repeat identically.'}
(ROOT/'native/comparison.json').write_text(json.dumps(native,indent=2)+'\n')
provenance={'workflow':'fanout -> DDR byte buses -> remaining DDR -> board','baselineRun':44296522072,'candidateFullBoardAndFanout31Run':44304579863,
    'nativeReplayRun':44304697085,'nativeCopperDrcRun':44306311856,'sourceCheckRun':44305247559,
    'baselineFanoutCommit':'8c699afbd643652c4923b15b63a56d82eb794833','measuredFixCommit':'65439fb38d1d86af15495553588cfe21b28a197a',
    'cleanMainReproCommit':'8bdc9a8d9d405af69a522ad99655f77251d9cbe7','cleanMainFixCommit':'80f8a8871626fdd470092c2ae9a8e1bb2b0cc731','cleanMainBase':'818eec347e93493c204992e84ece827c2f7a493e',
    'reproPr':'https://github.com/tscircuit/fanout-solver/pull/289','fixPr':'https://github.com/tscircuit/fanout-solver/pull/290',
    'controllerCommitFullBoards':'c7ed30ae','controllerCommitQuality':'f389cc4c','core':'0.0.2410','coreCommit':'5d9e4a0630bebe77003ee31e0dfa5993ee22e394',
    'router':'0.0.1124','routerCommit':'d88899c9ac79cf48491a402b5e3643b3efabe373','tscircuit':'0.0.3231','publishedFanout':'0.0.84','busLanes':'0.0.62','bun':'1.4.3',
    'routingBudgetMs':600000,'hardProcessBudgetMs':660000,'auditBudgetMs':180000,'worker':'blacksmith-8vcpu-ubuntu-2404-arm','concurrencyPerBoardWorker':1,
    'priorOpenAliasFixIncluded':False,'allSixSourceAndNativeFanoutInputsIdentical':True,'geometryMembershipErrors':0,
    'measurementScope':'Published stack versus that exact stack with only the 20-line fanout patch. PR branches were subsequently rebased onto current main to remove a published-version commit; the same production patch applies to unchanged route-bus/DRC files. Main also contains an unrelated blind-via change, covered by PR CI.',
    'infrastructureNote':'The first full-board workflow also contained two native diagnostic jobs with a report-only property typo. Those jobs failed after solving. All six board jobs and both fanout31 jobs succeeded. Both corrected native replay pairs completed in the separately linked runs.'}
analysis={'primary':primary,'boards':rows,'fanout31':fanout31,'native':native,'provenance':provenance,
    'totals':{phase:{'completedBoards':0,'busPhasesStarted':sum(row[phase]['busPhasesStarted'] for row in rows),'plannedBusPhases':sum(row[phase]['plannedBusPhases'] for row in rows),
        'acceptedTraces':sum(row[phase]['acceptedTraces'] for row in rows),'acceptedVias':sum(row[phase]['acceptedVias'] for row in rows),'connectedNets':sum(row[phase]['connectedNets'] for row in rows),'routableNets':sum(row[phase]['routableNets'] for row in rows)} for phase in ['before','after']},
    'finding':'Reserved pours block route validation despite an existing dogbone matcher exemption. The fix aligns route validation and independent copper DRC with that policy; fixed pads/holes/traces and terminal-layer pour reservations retain their checks.',
    'nextBottleneck':'Incomplete local fanout remains the gate: even the improved completed searches retain 113/250 unresolved connections, and OrangeCrab/H616 exhaust the 600s budget. DDR bus routing has not started, so this experiment provides no new bus-lane quality result.'}
(ROOT/'analysis.json').write_text(json.dumps(analysis,indent=2)+'\n');(ROOT/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')

def count_label(result):
    if result['bestRouted'] is not None:return f"{result['bestRouted']}/{result['requested']}"
    return f"{result['lastReportedRouted']} last reported; timeout"
summary_rows=''.join(f"<tr><td>{html.escape(row['title'])}</td><td>{count_label(row['before'])}</td><td>{count_label(row['after'])}</td><td>{(100*(row['after']['bestRouted']-row['before']['bestRouted'])/row['before']['requested']):.1f} pp</td></tr>" if row in finished else f"<tr><td>{html.escape(row['title'])}</td><td>{count_label(row['before'])}</td><td>{count_label(row['after'])}</td><td>Best result unavailable at timeout</td></tr>" for row in rows)
sections=[]
for row in rows:
    board=row['board'];before=row['before'];after=row['after']
    sections.append(f'''<section id="{board}"><h2>{html.escape(row['title'])}</h2><p>First fanout: {count_label(before)} → {count_label(after)}. Accepted output: {after['acceptedTraces']} traces, {after['acceptedVias']} vias; {after['connectedNets']}/{after['routableNets']} whole-board nets connected, unchanged.</p><div class="pair">'''+''.join(f'''<figure><a href="pcb/{phase}/{board}.svg"><img loading="lazy" src="pcb/{phase}/{board}.svg" alt="{phase} native full PCB output for {html.escape(row['title'])}"></a><figcaption>{phase.title()} full native PCB after fanout failure. No routed signal copper was accepted.</figcaption></figure>''' for phase in ['before','after'])+f'''</div><p><a href="full-board-models/{board}/{board}.tsx">Full TSX model</a> · <a href="after/{board}/circuit.json">After Circuit JSON</a> · <a href="before/{board}/circuit.json">Before Circuit JSON</a> · <a href="after/{board}/diagnostics.json">Diagnostics</a> · <a href="after/{board}/plan.json">Phase plan</a> · <a href="after/{board}/fanout-1-input.json.gz">Captured first-fanout input</a></p></section>''')
# Model entrypoints are recorded in each folder instead of assuming their name.
for index,(board,row) in enumerate(zip(BOARDS,sections)):
    tsx=list((ROOT/'full-board-models'/board).glob('*.tsx'))
    assert len(tsx)==1,(board,tsx)
    sections[index]=row.replace(f'full-board-models/{board}/{board}.tsx',str(tsx[0].relative_to(ROOT)))
page=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native plane-drop fix: six-board routing analysis</title>
<style>body{{max-width:1450px;margin:auto;padding:28px;font:16px/1.55 system-ui;background:#f4f6f9;color:#172033}}section{{background:white;border:1px solid #d8dee9;border-radius:12px;padding:24px;margin:24px 0}}h1,h2{{line-height:1.2}}a{{color:#1756b4}}table{{border-collapse:collapse;width:100%;font-size:15px}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #dce2ec}}th{{background:#edf2f8}}img{{width:100%;background:white;border:1px solid #d8dee9}}figure{{margin:0}}figcaption{{font-size:14px;color:#465469}}.status{{border-left:4px solid #b54a39;background:#fff3ef;padding:12px}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}pre{{white-space:pre-wrap;background:#edf2f8;padding:16px}}@media(max-width:800px){{body{{padding:12px}}.pair{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style>
<h1>Native plane-drop fix: six-board routing analysis</h1><p>18 November 2026 · Fanout → DDR buses → remaining nets · Original tracks, vias and filled zones removed; original geometry, nets and design rules retained.</p>
<section><h2>51.5% fewer unresolved connections in four completed fanout searches</h2><p>The best partial assignments improve from 17/250 (6.8%) to 137/250 (54.8%), a 48 percentage-point increase. This aggregate covers ButterStick, Glider, i.MX6 and iCE/Pi. OrangeCrab and H616 time out; their last reported progress is listed separately.</p><p class="status"><strong>All six full boards still fail in fanout.</strong> Completed boards: 0/6 → 0/6. DDR bus phases started: 0/12 → 0/12. Accepted traces/vias: 0/0 → 0/0. The native partial fanout illustrations below are diagnostic output and were not committed to the final PCBs.</p>
<table><thead><tr><th>Board / first fanout</th><th>Before</th><th>After</th><th>Completeness change</th></tr></thead><tbody>{summary_rows}</tbody></table><p>Completed-search rows use the solver's explicit best-assignment error, rather than the last attempted assignment. Timeout rows show only last reported progress and are excluded from the 51.5% figure. Connected whole-board nets remain 22/1580; those existing pad/pour connections do not indicate successful routing.</p>
<p>Fanout31: 29/72 solved and 43 timeouts in both runs. All 72 captured inputs are byte-identical; status, routed counts, validated breakouts and via counts are unchanged. The same 120s per-case deadline and 32-worker concurrency apply.</p></section>
<section><h2>What changed</h2><p>Dogbone candidate selection already lets a via cross a reserved pour on another layer, where core can regenerate an antipad. Route validation rejected that same candidate. The 20-line fix applies the existing policy to route validation and preserves entry/exit-layer checks in the independent copper DRC. Physical pads, holes and supplied copper remain obstacles on every spanned layer.</p><p>The focused native U22 pin101 replay below uses the captured regional geometry with its original 0.45/0.2 mm through-via, 0.1 mm clearance, and via-in-pad prohibition. All 175 regional pour reservations remain in the search input. This isolated drop becomes routable; pin101 remains unresolved in the complete best assignment, where the other connections compete for space.</p><div class="pair"><figure><img src="focused/before.svg" alt="Native focused plane drop before"><figcaption>Before: 0/1 routed.</figcaption></figure><figure><img src="focused/after.svg" alt="Native focused plane drop after"><figcaption>After: 1/1 routed with one physical through-via.</figcaption></figure></div></section>
<section><h2>Actual native U22 fanout before and after</h2><p>Both complete native replays produce the same best geometry in repeated runs: 1/32 → 7/32 routed connections. The after result has six local plane drops and one boundary escape. Its seven vias comprise those six plane drops plus a layer change on the boundary escape. Independent copper DRC checks all seven emitted traces and seven vias with zero issues. Full fanout remains incomplete in both cases.</p><div class="pair"><figure><img src="native/before/u22-cut.svg" alt="Before best native U22 partial fanout"><figcaption>Before native best partial assignment.</figcaption></figure><figure><img src="native/after/u22-cut.svg" alt="After best native U22 partial fanout"><figcaption>After native best partial assignment.</figcaption></figure></div><p><a href="native-quality/after/best-traces.json">Actual after trace geometry</a> · <a href="native-quality/after/report.json">Independent copper DRC</a> · <a href="native/comparison.json">Both repeated replay pairs</a></p><p>Runtime varied in opposite directions across the two worker pairs; the evidence supports a routing correction, without establishing a reliable speed improvement.</p></section>
<section><h2>Regenerated pour clearance</h2><p>A separate integration replay through published core 0.0.2410 materializes the same 0.45/0.2 mm via on all four layers. The final foreign-plane BREP has a 32-vertex antipad with radius 0.325 mm: the 0.225 mm via radius plus the configured 0.1 mm clearance. This proof checks the actual generated copper rather than assuming the reservation flag makes a crossing safe.</p><p><a href="antipad-proof/result.json">Measured antipad and version checksums</a> · <a href="antipad-proof/prove-antipad.ts">Integration proof</a> · <a href="antipad-proof/reproduce.sh">Reproduce the proof</a></p></section>
{''.join(sections)}
<section><h2>Analysis and reproducibility</h2><p>This was the broadest deterministic failure found in the corrected workflow: reserved pours surround every local plane drop in all six initial fanout inputs. Fixing their inconsistent treatment improves all four exhaustive searches substantially, while retaining the existing geometry rules. The next gate remains completing local fanout; the four exhaustive searches still leave 113/250 connections unresolved. This run cannot assess DDR bus routing because that stage never starts.</p><p>All six source hashes and first-fanout inputs match before and after. Geometry and net-membership audits have zero errors. The absence of physical findings on the full PCBs reflects zero accepted traces; it does not make them passing boards. The independently validated native partial output and final-pour integration proof provide the nonempty copper checks.</p><p><a href="https://github.com/tscircuit/fanout-solver/pull/289">Before-only repro PR #289</a> · <a href="https://github.com/tscircuit/fanout-solver/pull/290">Stacked fix PR #290</a> · <a href="circuits-and-results.zip">Full TSX sources and results ZIP</a> · <a href="analysis.json">Machine-readable analysis</a> · <a href="provenance.json">Exact source revisions, budgets and run links</a> · <a href="full-board-models/reproduce-candidate.sh">Reproduce before or after</a></p><p>Earlier open PRs remain untouched and their alias optimization is excluded. The source PRs contain the native fixture, snapshot, focused guard and small production patch; analysis artifacts are kept on a separate evidence branch.</p></section></html>'''
(ROOT/'index.html').write_text(page)
print(json.dumps({'primary':primary,'fanout31':fanout31,'nativeDrc':native['copperDrc'],'totals':analysis['totals']},indent=2))
