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
    assert build == {'coreCommit':'24f154d17cf2c54186b842bdab2f990edcf42a31','coreVersion':'0.0.2422'}, build
    assert runtime['dependencies']['tscircuit'] == progress['runtime']['tscircuit'] == '0.0.3238'
    expected = '0.0.88' if phase == 'baseline' else 'https://codeload.github.com/tscircuit/fanout-solver/tar.gz/92915064b3da6a95be221b511f1cb87c705fa590'
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

rows=[]
for board,title in BOARDS.items():
    before=board_result('baseline',board);after=board_result('candidate',board)
    for key in ['requested','inputSha256','sourceSha256','nonErrorCircuitSha256','rules']:assert before[key]==after[key],(board,key)
    assert before['geometryErrors']==after['geometryErrors']==before['membershipErrors']==after['membershipErrors']==0
    rows.append({'board':board,'title':title,'before':before,'after':after})
pairs={}
for board in ['icepi','imx6']:
    trials=read(f'paired/{board}/comparison.json');summary=read(f'paired/{board}/summary.json')
    assert len(trials)==6 and len({r['inputSha256'] for r in trials})==len({r['copperSha256'] for r in trials})==1
    full=next(r for r in rows if r['board']==board);assert trials[0]['inputSha256']==full['before']['inputSha256']
    assert all(r['copperDrc']['valid'] and not r['copperDrc']['issues'] for r in trials)
    assert all(r['bestPartial']==trials[0]['bestPartial'] and r['iterations']==trials[0]['iterations'] for r in trials)
    for metric in ['medianMs','p95Ms']:assert summary['after'][metric]<summary['before'][metric],(board,metric)
    summary['inputSha256']=trials[0]['inputSha256'];summary['copperSha256']=trials[0]['copperSha256']
    for phase in ['before','after']:summary[phase]['meanMs']=statistics.mean(summary[phase]['timesMs'])
    summary['meanReductionPercent']=(1-summary['after']['meanMs']/summary['before']['meanMs'])*100
    assert summary['meanReductionPercent']>0
    summary['scope']='Three serial matched native search pairs per scene on one Blacksmith8vCPUARM worker, alternating order. Searches still fail with partial fanout. P95 is descriptive for three samples.'
    pairs[board]=summary
isolated=read('isolated/summary.json')
assert sum(r['before']['cases'] for r in isolated)==349
assert all(r['inputsMatch'] and not r['regressions'] and not r['changedCopper'] and not r['before']['invalid'] and not r['after']['invalid'] and r['before']['outcomes']==r['after']['outcomes'] for r in isolated)
for r in isolated:assert r['nativeCaptureSha256']==next(x for x in rows if x['board']==r['board'])['before']['inputSha256']
assert sum(r['before']['outcomes'].get('solved',0) for r in isolated)==292
assert read('baseline/fanout31/input-checksums.json')==read('candidate/fanout31/input-checksums.json')
guard={phase:read(f'{phase}/fanout31/report.json') for phase in ['baseline','candidate']}
for before,after in zip(guard['baseline']['rows'],guard['candidate']['rows']):assert before['sample']==after['sample'] and all(before[k]==after[k] for k in ['status','routed','validatedBreakouts','vias'])
audit=read('fanout31-svg-audit.json');assert audit['allRoutedSvgsIdentical'] and audit['beforeSvgCount']==audit['afterSvgCount']==30
outcomes={phase:{status:sum(r['status']==status for r in report['rows']) for status in ['solved','timeout','failed']} for phase,report in guard.items()}
analysis={'provenance':read('provenance.json'),'boards':rows,'pairedNative':pairs,'isolatedNativePlaneBuses':{'cases':349,'beforeAccepted':292,'afterAccepted':292,'allPairedInputsIdentical':True,'allAcceptedCopperHashesIdentical':True,'acceptedCopperDrcIssues':0,'scope':'Each native plane bus tested separately with all original obstacles/rules; not joint fanout or whole-board completion.','boards':isolated},'fanout31':{'cases':72,'outcomes':outcomes,'allOutcomesRoutedCountsAndViasIdentical':True,'all30SolvedSvgsByteIdentical':True},'focusedNativeDrop':{'boundarySlotCalculationsBefore':1,'boundarySlotCalculationsAfter':0,'candidateViasBefore':1,'candidateViasAfter':1,'copperDrcIssues':0},'completeBoards':{phase:sum(r[phase]['status']=='completed' for r in rows) for phase in ['before','after']},'ddrBusPhasesStarted':{phase:sum(r[phase]['busPhasesStarted'] for r in rows) for phase in ['before','after']},'timingNote':'Full-board times are single failed/deadline-limited render-and-route observations on separate workers; they exclude the subsequent independent audit and are not matched successful solve-time measurements. Headline timings use serial matched native repeats.','decision':'Keep the optimization: both native medians, means and descriptive P95s improve. Copper, vias, iterations, all 349 isolated outcomes and all 72 guard outcomes match. All 30 solved SVGs are identical; whole-board completion remains 0/6.'}
(ROOT/'analysis.json').write_text(json.dumps(analysis,indent=2)+'\n')
full_table=''.join(f"<tr><td>{html.escape(r['title'])}</td><td>{r['before']['bestRouted']}/{r['before']['requested']}</td><td>{r['after']['bestRouted']}/{r['after']['requested']}</td><td>{r['before']['elapsedMs']/1000:.1f} → {r['after']['elapsedMs']/1000:.1f}</td><td>{r['before']['assignment']} → {r['after']['assignment']}</td></tr>" for r in rows)
pair_table=''.join(f"<tr><td>{BOARDS[board]}</td><td>{s['before']['medianMs']/1000:.1f}</td><td>{s['after']['medianMs']/1000:.1f}</td><td>{s['medianReductionPercent']:.1f}%</td><td>{s['before']['p95Ms']/1000:.1f} → {s['after']['p95Ms']/1000:.1f}</td><td>{s['before']['routed']}</td><td>{s['before']['vias']}</td></tr>" for board,s in pairs.items())
sections=''.join(f'<section><h2>{html.escape(title)}</h2><div class="pair"><figure><img loading="lazy" src="pcb/baseline/{board}.svg"><figcaption>Before: full PCB after failed fanout</figcaption></figure><figure><img loading="lazy" src="pcb/candidate/{board}.svg"><figcaption>After: full PCB after failed fanout</figcaption></figure></div></section>' for board,title in BOARDS.items())
page=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native plane-layout performance</title><style>body{{max-width:1450px;margin:auto;padding:24px;background:#f4f6f9;color:#172033;font:16px/1.5 system-ui}}section{{background:white;padding:24px;margin:24px 0;border:1px solid #d8dee9;border-radius:10px}}table{{width:100%;border-collapse:collapse}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #dce2ec}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}figure{{margin:0}}img{{width:100%;background:white}}a{{color:#1756b4}}@media(max-width:800px){{.pair{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style><h1>Skip unused boundary layout for native plane escapes</h1><p>tscircuit0.0.3238 · core0.0.2422 · autorouter0.0.1131 · fanout0.0.88 · bus lanes0.0.62. All original copper removed; fanout → DDR buses → remaining DDR → board.</p><p><a href="circuits-and-results.zip">TSX sources, SVGs and raw results ZIP</a> · <a href="all-boards.svg">All six PCB comparisons</a> · <a href="analysis.json">Analysis</a> · <a href="provenance.json">Revisions/runs</a> · <a href="https://github.com/tscircuit/fanout-solver/pull/301">Repro301</a> · <a href="https://github.com/tscircuit/fanout-solver/pull/302">Fix302</a></p>
<section><h2>Measured native search improvement</h2><p>The latest native profile attributes52.1% of sampled CPU time to buildPlan (inclusive) and95.3% to plane-route search. A plane escape that terminates at its via still computed boundary/corner coordinates and slots. The fix moves that existing work behind the branch that uses it, retaining ordinary boundary and layered-winding behavior.</p><table><tr><th>Scene</th><th>Before median s</th><th>After median s</th><th>Reduction</th><th>P95 s</th><th>Partial routes</th><th>Vias</th></tr>{pair_table}</table><p>Each scene uses three serial matched pairs on one Blacksmith8vCPUARM worker, alternating before/after,after/before,before/after. P95 is descriptive with three samples. All six runs per scene use identical input and copper hashes,26,131iterations and zero independent copper DRC issues. These are times to finish a partial failed fanout search, not complete-board solve times.</p></section>
<section><h2>Focused native before/after</h2><p>The original U22 escape retains its exact two-segment path and Ø0.45/0.2mm through-via. Unused boundary-slot calculations fall1→0; independent DRC remains clear. The test-owned getter records actual work and updates the same native SVG through the stacked fix.</p><div class="pair"><img src="focused/before.svg"><img src="focused/after.svg"></div></section>
<section><h2>Actual joint native routing before/after</h2><p>U22 remains7/32 partial routes and7vias. Copper geometry is identical; the labels show measured medians from the three matched pairs. This partial output is not accepted into the final PCB.</p><div class="pair"><img src="paired/icepi/before.svg"><img src="paired/icepi/after.svg"></div></section>
<section><h2>Quality and full-board results</h2><p><b>0/6 complete boards;0/12 DDR bus phases start;zero accepted board traces or vias in both versions.</b> Every full-board source/input/rule hash matches; all non-error Circuit JSON records match. Geometry and net-membership audits pass. Empty final copper is not a passing board.</p><table><tr><th>Board</th><th>Best first fanout before</th><th>After</th><th>Render/routing s</th><th>Assignments</th></tr>{full_table}</table><p>OrangeCrab's118→122 are unaccepted requests in its first273-request region. The600s routing deadline allows more search; this is not a connected full-board net count. All other best first-region counts match. Whole-board times are single unpaired failed/deadline-limited observations that include initialization and exclude the subsequent audit.</p><p>All349 isolated native plane-bus outcomes remain unchanged:292accepted,57failed,no timeouts. All292accepted copper hashes match with zero independent DRC issues. Fanout31 remains30solved/42timed out;all72inputs,outcomes,routed counts andvia counts match, andall30solvedSVGs arebyte-identical. Native same-worker complete-object checks also match default/fixed plane plans and ordinary/layered corner outputs.</p></section>
<section><h2>Revisions and validation</h2><p>The measured production revision is9291506; final578e4ca changes one line wrap and produces identical transpiled code. All fabrication rules, the0.7mm boundary padding, routing order and emitted geometry are preserved. Source-built core advertises the next patch in software metadata; core-build.json records the actual frozen0.0.2422package and24f154d revision.</p><p>The first iCE/Pi timing job failed at artifact transport before routing and was repeated in the final-check run. Only the six successful matched reports are used. Exact CI workflows, full results, CPU profile and checksum proofs are included. The six TSX models, geometry/net membership, runtime lock and reproduce-comparison.sh are in sources.</p></section>{sections}</html>'''
for old,new in [('tscircuit0.0','tscircuit 0.0'),('core0.0','core 0.0'),('autorouter0.0','autorouter 0.0'),('fanout0.0','fanout 0.0'),('lanes0.0','lanes 0.0'),('attributes52.1%','attributes 52.1%'),('and95.3%','and 95.3%'),('Blacksmith8vCPUARM','Blacksmith 8 vCPU ARM'),('26,131iterations','26,131 iterations'),('remains7/32','remains 7/32'),('and7vias','and 7 vias'),('obstacles/rules','obstacles and rules'),('all349','all 349'),('All349','All 349'),('292accepted','292 accepted'),('57failed','57 failed'),('30solved','30 solved'),('42timed','42 timed'),('all72','all 72'),('andvia','and via'),('andall30','and all 30'),('solvedSVGs','solved SVGs'),('arebyte','are byte'),('the600s','the 600 s'),('The600s','The 600 s'),('the0.7mm','the 0.7 mm'),('frozen0.0','frozen 0.0'),('and24f154d','and 24f154d'),('is9291506','is 9291506'),('final578e4ca','final 578e4ca'),('Ø0.45/0.2mm','Ø0.45/0.2 mm'),('fall1→0','fall 1→0'),('boards;0/12','boards; 0/12'),('start;zero','start; zero'),('boards;zero','boards; zero')]:
    page=page.replace(old,new)
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
print(json.dumps({'nativeMedianReductionPercent':{board:summary['medianReductionPercent'] for board,summary in pairs.items()},'completeBoards':analysis['completeBoards'],'fanout31':outcomes}))
