from pathlib import Path
import gzip, hashlib, html, json, statistics
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
BOARDS = {'orangecrab':'OrangeCrab rev 0.2.1 ECP5 DDR3','h616':'Allwinner H616 Devboard DDR3','butterstick':'ButterStick r1.0','glider':'Glider mainboard','imx6':'i.MX6 Demo Board','icepi':'iCE/Pi CM0 SBC'}

def read(path):
    path = ROOT / path
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes())

def digest(serialized):
    return hashlib.sha256(serialized).hexdigest()

def board_result(phase, board):
    folder = ROOT / phase / 'boards' / board
    progress = read(folder/'progress.json')
    diagnostics = read(folder/'diagnostics.json')
    assessment = read(folder/'assessment.json')
    plan = read(folder/'plan.json')
    build = read(folder/'core-build.json')
    package = read(folder/'core-package.json')
    runtime = read(folder/'runtime-package.json')
    assert build == {'coreCommit':'192976770dca61204aa82ec99e75c49d59e05c16','coreVersion':'0.0.2419'}, build
    assert runtime['dependencies']['tscircuit'] == progress['runtime']['tscircuit'] == '0.0.3237'
    expected = '0.0.87' if phase == 'baseline' else 'https://codeload.github.com/tscircuit/fanout-solver/tar.gz/44ed0c8393e5395f7c00ca1fe31c09e021cc1ce2'
    assert package['devDependencies']['@tscircuit/fanout-solver'] == expected
    serialized = gzip.decompress((folder/'fanout-1-input.json.gz').read_bytes())
    captured = json.loads(serialized)
    kinds = [p['autorouter'] for p in plan['plans']]
    fanouts = [i for i,k in enumerate(kinds) if k == 'fanout']
    buses = [i for i,k in enumerate(kinds) if k == 'bus_lanes']
    remaining = [i for i,k in enumerate(kinds) if k == 'auto_local']
    assert max(fanouts) < min(buses) and max(buses) < min(remaining)
    assert plan['initialCopperElements'] == progress['initialCopperElements'] == 0
    circuit = read(folder/'circuit.json.gz')
    physical = [e for e in circuit if not e['type'].endswith('_error')]
    state = diagnostics['fanoutLastState']
    return {'requested':len(captured['solverParams']['connections']),'bestRouted':diagnostics['fanoutBestSummary']['routedConnectionCount'],'assignment':state['stats']['assignment'],'maxAssignments':state['stats']['assignmentCount'],'searchExhausted':state['failed'],'fanoutSolved':state['solved'],'status':progress['status'],'elapsedMs':progress['elapsedMs'],'fanoutMs':progress['phases'][0]['elapsedMs'],'inputSha256':digest(serialized),'sourceSha256':plan['sourceSha256'],'nonErrorCircuitSha256':digest(json.dumps(physical,sort_keys=True,separators=(',',':')).encode()),'acceptedTraces':assessment['pcbTraces'],'acceptedVias':assessment['vias'],'connectedNets':assessment['connectedNets'],'routableNets':assessment['routableNets'],'geometryErrors':len(assessment['geometryErrors']),'membershipErrors':len(assessment['membershipErrors']),'physicalFindings':sum(v for k,v in assessment['findings'].items() if k != 'routing'),'plannedBuses':len(buses),'busPhasesStarted':sum(p['solver']=='BusLanesPipelineSolver' for p in progress['phases']),'rules':{k:captured['solverParams'][k] for k in ['minTraceWidth','minViaPadDiameter','minViaHoleDiameter','minViaEdgeToPadEdgeClearance','allowBlindAndBuriedVias','allowViaInPad']}}

rows = []
for board,title in BOARDS.items():
    before = board_result('baseline',board)
    after = board_result('candidate',board)
    for key in ['requested','inputSha256','sourceSha256','nonErrorCircuitSha256','rules']:
        assert before[key] == after[key], (board,key)
    assert before['geometryErrors'] == after['geometryErrors'] == before['membershipErrors'] == after['membershipErrors'] == 0
    rows.append({'board':board,'title':title,'before':before,'after':after})

isolated = read('isolated/summary.json')
assert all(r['inputsMatch'] and not r['regressions'] and not r['changedCopper'] for r in isolated)
for isolated_board in isolated:
    full_board = next(r for r in rows if r['board'] == isolated_board['board'])
    assert isolated_board['nativeCaptureSha256'] == full_board['before']['inputSha256'] == full_board['after']['inputSha256']
isolated_totals = {}
for phase in ['before','after']:
    outcomes = {'solved':0,'failed':0,'timeout':0}
    for row in isolated:
        for outcome,count in row[phase]['outcomes'].items(): outcomes[outcome] += count
        assert row[phase]['invalid'] == 0
    isolated_totals[phase] = outcomes
cases = sum(isolated_totals['before'].values())
assert cases == sum(isolated_totals['after'].values()) == 349
gain = isolated_totals['after']['solved'] - isolated_totals['before']['solved']
guard = {phase:read(f'{phase}/fanout31/report.json') for phase in ['baseline','candidate']}
assert read('baseline/fanout31/input-checksums.json') == read('candidate/fanout31/input-checksums.json')
guard_outcomes = {}
for phase,report in guard.items():
    guard_outcomes[phase] = {status:sum(r['status']==status for r in report['rows']) for status in ['solved','timeout','failed']}
for before,after in zip(guard['baseline']['rows'],guard['candidate']['rows']):
    assert before['sample'] == after['sample']
    assert all(before[k] == after[k] for k in ['status','routed','validatedBreakouts','vias'])

analysis = {'provenance':read('provenance.json'),'boards':rows,'isolatedNativePlaneBuses':{'scope':'Each declared plane bus is solved separately with all original obstacles, rule values and direction/layer guidance. This is not joint fanout or whole-board completion.','cases':cases,**isolated_totals,'additionalSolved':gain,'beforePercent':100*isolated_totals['before']['solved']/cases,'afterPercent':100*isolated_totals['after']['solved']/cases,'gainPercentagePoints':100*gain/cases,'pairedInputsIdentical':349,'previouslySolvedCopperHashesIdentical':28,'invalidAcceptedOutputs':0,'boards':isolated},'focusedNativeDrop':{'acceptedBefore':0,'acceptedAfter':1,'candidateViaCountBefore':1,'candidateViaCountAfter':1,'finalIssuesBefore':2,'finalIssuesAfter':0,'independentCopperDrcIssues':0,'retainedRegionalObstacles':344},'fanout31':{'cases':72,'outcomes':guard_outcomes,'allOutcomesRoutedCountsAndViasIdentical':True},'completeBoards':{phase:sum(r[phase]['status']=='completed' for r in rows) for phase in ['before','after']},'ddrBusPhasesStarted':{phase:sum(r[phase]['busPhasesStarted'] for r in rows) for phase in ['before','after']},'physicalAuditNote':'Zero copper DRC findings on a failed whole board with no accepted routes do not establish a passing board.','timingNote':'Whole-board times are one failed or budget-limited run per version on separate workers; no runtime improvement is claimed. Isolated-case timing rows are preserved as raw observations only.','decision':'Retain the nine-line correctness fix: eliminate false final-validation rejection of legal crossed-pour vias, preserve endpoint pours/pads/holes, and increase isolated native plane-bus acceptance. All six joint full-board fanouts remain incomplete.'}
(ROOT/'analysis.json').write_text(json.dumps(analysis,indent=2)+'\n')

full_table = ''.join(f"<tr><td>{html.escape(r['title'])}</td><td>{r['before']['bestRouted']}/{r['before']['requested']}</td><td>{r['after']['bestRouted']}/{r['after']['requested']}</td><td>{r['before']['elapsedMs']/1000:.1f} → {r['after']['elapsedMs']/1000:.1f}</td><td>{r['before']['assignment']} → {r['after']['assignment']}</td><td>{r['after']['acceptedTraces']} / {r['after']['acceptedVias']}</td></tr>" for r in rows)
isolated_by_board = {r['board']:r for r in isolated}
plane_table = ''.join(f"<tr><td>{html.escape(title)}</td><td>{isolated_by_board[board]['before']['outcomes'].get('solved',0)}/{isolated_by_board[board]['before']['cases']}</td><td>{isolated_by_board[board]['after']['outcomes'].get('solved',0)}/{isolated_by_board[board]['after']['cases']}</td></tr>" for board,title in BOARDS.items())
panels = ''.join(f'<section><h2>{html.escape(title)}</h2><div class="pair"><figure><img loading="lazy" src="pcb/baseline/{board}.svg"><figcaption>Before: full PCB after failed fanout</figcaption></figure><figure><img loading="lazy" src="pcb/candidate/{board}.svg"><figcaption>After: full PCB after failed fanout</figcaption></figure></div></section>' for board,title in BOARDS.items())
page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native fanout final-validation analysis</title><style>body{{max-width:1450px;margin:auto;padding:24px;background:#f4f6f9;color:#172033;font:16px/1.5 system-ui}}section{{background:white;padding:24px;margin:24px 0;border:1px solid #d8dee9;border-radius:10px}}table{{width:100%;border-collapse:collapse}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #dce2ec}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}figure{{margin:0}}img{{width:100%;background:white}}a{{color:#1756b4}}@media(max-width:800px){{.pair{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style>
<h1>Native fanout: correct final validation of crossed pours</h1><p>tscircuit 0.0.3237 · core 0.0.2419 · autorouter 0.0.1129 · fanout 0.0.87 · bus lanes 0.0.62. Fresh routing order: fanout → DDR byte buses → remaining DDR → board.</p><p><a href="circuits-and-results.zip">TSX sources, SVGs and raw results ZIP</a> · <a href="all-boards.svg">All six PCB comparisons</a> · <a href="analysis.json">Machine-readable analysis</a> · <a href="provenance.json">Exact revisions and runs</a> · <a href="https://github.com/tscircuit/fanout-solver/pull/297">Repro #297</a> · <a href="https://github.com/tscircuit/fanout-solver/pull/298">Fix #298</a></p>
<section><h2>What improves</h2><p>Final validation treated crossed foreign copper-pour reservations as solid via obstacles, contradicting route search and independent copper DRC. The nine-line fix applies the existing antipad rule while retaining both terminal-layer pour checks and all physical pad/hole checks.</p><p><b>Isolated native plane-bus acceptance: 28/349 (8.0%) → 292/349 (83.7%), +75.6 percentage points.</b> Every declared plane bus from the six first-fanout captures was tested separately. All 349 paired inputs match; all 292 accepted outputs pass independent copper DRC against the original full input. No case times out. All 28 previously accepted routes have identical copper hashes.</p><table><tr><th>Board</th><th>Before, isolated plane buses</th><th>After, isolated plane buses</th></tr>{plane_table}</table><p>These cases do not establish that the buses can route together. They retain every original obstacle and fabrication rule, but select one declared plane bus at a time. The actual whole-board results are below.</p></section>
<section><h2>Native routed before / after</h2><p>U22 pin101: one declared plane drop, all 344 regional obstacles, Ø0.45/0.2 mm via and 0.1 mm clearance. The searched copper is identical. Final findings fall from two to zero (100% fewer); the actual FanoutSolver changes from rejection to acceptance. Independent copper DRC reports zero issues in both.</p><div class="pair"><figure><img src="focused/before.svg"><figcaption>Before: legal candidate rejected</figcaption></figure><figure><img src="focused/after.svg"><figcaption>After: same candidate accepted</figcaption></figure></div></section>
<section><h2>Full-board routing remains blocked</h2><p><b>0/6 complete boards; 0/12 DDR bus phases start; zero accepted traces or vias in both versions.</b> All saved input copper was removed. The runtime core build manifests, source hashes, native fanout inputs, geometry and net-membership audits are preserved. All non-error Circuit JSON records match across versions.</p><table><tr><th>Board</th><th>Best first fanout before</th><th>After</th><th>Full elapsed s</th><th>Assignments</th><th>Accepted traces / vias</th></tr>{full_table}</table><p>Partial first-fanout counts are not connected full-board nets. A 600 s routing budget and 660 s process limit apply. Budget-limited search counts can vary by worker; those differences are not attributed to this validation fix. Whole-board elapsed times are single unpaired failed-route observations, not successful solve-time measurements.</p><p>Complete-solution validation runs only after all requests in a fanout are routed. The original 32-connection iCE/Pi fanout remains partial and does not reach that stage. Its native profile spends 93.7% of sampled time in plane-route construction/search and 52.2% in buildPlan (inclusive rows overlap). Earlier joint candidate generation and mutual clearance remain the next full-board investigation target.</p></section>
<section><h2>Regression checks</h2><p>Fanout31: 30 solved and 42 timed out in both versions, with all 72 inputs, outcomes, routed counts and via counts unchanged. The focused controls cover crossed pours, foreign source/target pours, real pads and non-plated through-holes. Source format and full typecheck are checked on the final commit; the repository test shards run on macOS ARM as prescribed.</p><p>Source-built core metadata advertises the next patch via getCoreVersion(); core-build.json records the actual frozen 0.0.2419 package and Git revision. No fabrication-rule, boundary-padding or solver-order changes were made.</p></section>{panels}<section><h2>Reproduce</h2><p>Use Bun 1.4.3 and the exact source refs in provenance.json. The sources directory contains the six TSX models, original geometry/net membership, rendering/audit harness and pinned runtime lockfile. sources/reproduce-comparison.sh matches the Blacksmith full-board commands; workflows contains the exact executed CI definitions. Isolated reports retain every case, including failures.</p></section></html>'''
(ROOT/'index.html').write_text(page)

ET.register_namespace('', 'http://www.w3.org/2000/svg')
ns = '{http://www.w3.org/2000/svg}'
svg = ET.Element(ns+'svg',{'width':'2000','height':str(len(rows)*800+80),'viewBox':f'0 0 2000 {len(rows)*800+80}'})
ET.SubElement(svg,ns+'rect',{'width':'100%','height':'100%','fill':'#f4f6f9'})
ET.SubElement(svg,ns+'text',{'x':'30','y':'45','font-size':'25','font-family':'sans-serif','fill':'#172033'}).text='Six full PCBs — before / after; all remain blocked in fanout'
styles = set()
for row_index,(board,title) in enumerate(BOARDS.items()):
    for col,phase in enumerate(['baseline','candidate']):
        x,y = 20+col*1000,80+row_index*800
        ET.SubElement(svg,ns+'text',{'x':str(x),'y':str(y+30),'font-size':'21','font-family':'sans-serif','fill':'#172033'}).text=f'{title} — {"Before" if col==0 else "After"}'
        native = ET.parse(ROOT/'pcb'/phase/(board+'.svg')).getroot()
        native.set('viewBox', f"0 0 {native.attrib['width']} {native.attrib['height']}")
        native.set('x',str(x));native.set('y',str(y+45));native.set('width','960');native.set('height','720')
        prefix=f'{board}-{phase}-'
        identifiers = {e.attrib['id']:prefix+e.attrib['id'] for e in native.iter() if 'id' in e.attrib}
        for e in native.iter():
            for key,content in list(e.attrib.items()):
                if key == 'id': e.set(key,identifiers[content]);continue
                for old,new in identifiers.items(): content=content.replace(f'url(#{old})',f'url(#{new})')
                if content.startswith('#') and content[1:] in identifiers: content='#'+identifiers[content[1:]]
                e.set(key,content)
        for parent in native.iter():
            for child in list(parent):
                if child.tag == ns+'style' and child.text:
                    if child.text in styles: parent.remove(child)
                    else: styles.add(child.text)
        svg.append(native)
ET.ElementTree(svg).write(ROOT/'all-boards.svg',encoding='utf-8',xml_declaration=True)
print(json.dumps({'isolatedBefore':isolated_totals['before'],'isolatedAfter':isolated_totals['after'],'gainPercentagePoints':100*gain/cases,'completeBoards':analysis['completeBoards'],'fanout31':guard_outcomes}))
