from pathlib import Path
import gzip, hashlib, html, json, re, statistics, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
BOARDS = {'orangecrab':'OrangeCrab rev 0.2.1 ECP5 DDR3','h616':'Allwinner H616 Devboard DDR3','butterstick':'ButterStick r1.0','glider':'Glider mainboard','imx6':'i.MX6 Demo Board','icepi':'iCE/Pi CM0 SBC'}
VERSIONS = {'tscircuit':'0.0.3243','core':'0.0.2425','capacityAutorouter':'0.0.1133','fanout':'0.0.89','busLanes':'0.0.62','bun':'1.4.3'}
COMMITS = {'tscircuit':'ec0c9778775d4bb816fa100163a697fea0ae4072','core':'1799ee7e500a4de9d76a308286787307c4face1e','capacityAutorouter':'a4f2778cb40bbc9c147b95a4e48ef0b32f1dd08f','fanoutBaseline':'65b4a7f28f1d49e402a37d3b48973f54b32d2004','measuredFix':'8ea3683f561421c2c24a43d8257edccff7c4a802','repro':'8eb60029afab1ff418f72e48bb417b33379b07a9','fix':'035f888521731802b169a8816fef1ef41a5b7d76'}

def read(relative):
    path = ROOT / relative
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes())

def sha256(serialized):
    return hashlib.sha256(serialized).hexdigest()

def quantile(samples, fraction):
    ordered = sorted(samples)
    position = (len(ordered)-1)*fraction
    lower = int(position)
    upper = min(lower+1,len(ordered)-1)
    return ordered[lower]+(ordered[upper]-ordered[lower])*(position-lower)

def board_result(phase, board):
    folder = Path(phase)/'boards'/board
    progress = read(folder/'progress.json')
    diagnostic = read(folder/'diagnostics.json')
    assessment = read(folder/'assessment.json')
    plan = read(folder/'plan.json')
    build = read(folder/'core-build.json')
    package = read(folder/'core-package.json')
    runtime = read(folder/'runtime-package.json')
    assert build == {'coreCommit':COMMITS['core'],'coreVersion':VERSIONS['core']}
    assert runtime['dependencies']['tscircuit'] == progress['runtime']['tscircuit'] == VERSIONS['tscircuit']
    expected = VERSIONS['fanout'] if phase == 'baseline' else 'https://codeload.github.com/tscircuit/fanout-solver/tar.gz/'+COMMITS['measuredFix']
    assert package['devDependencies']['@tscircuit/fanout-solver'] == expected
    assert progress['runtime']['routerCommit'] == COMMITS['capacityAutorouter']
    serialized = gzip.decompress((ROOT/folder/'fanout-1-input.json.gz').read_bytes())
    captured = json.loads(serialized)
    phases = [entry['autorouter'] for entry in plan['plans']]
    fanouts = [i for i,kind in enumerate(phases) if kind == 'fanout']
    buses = [i for i,kind in enumerate(phases) if kind == 'bus_lanes']
    remaining = [i for i,kind in enumerate(phases) if kind == 'auto_local']
    assert max(fanouts)<min(buses) and max(buses)<min(remaining)
    assert plan['initialCopperElements'] == progress['initialCopperElements'] == 0
    circuit = read(folder/'circuit.json.gz')
    physical = [element for element in circuit if not element['type'].endswith('_error')]
    state = diagnostic['fanoutLastState']
    return {
        'status':progress['status'],'fullRenderComplete':progress['renderCompleted'],
        'firstRegionRequestedConnections':len(captured['solverParams']['connections']),
        'bestPartialConnections':diagnostic['fanoutBestSummary']['routedConnectionCount'],
        'assignmentsReached':state['stats']['assignment'],'maximumAssignments':state['stats']['assignmentCount'],
        'searchExhausted':state['failed'],'searchSolved':state['solved'],
        'elapsedMs':progress['elapsedMs'],'firstFanoutMs':progress['phases'][0]['elapsedMs'],
        'inputSha256':sha256(serialized),'sourceSha256':plan['sourceSha256'],
        'nonErrorCircuitSha256':sha256(json.dumps(physical,sort_keys=True,separators=(',',':')).encode()),
        'acceptedTraces':assessment['pcbTraces'],'acceptedVias':assessment['vias'],
        'geometryErrors':len(assessment['geometryErrors']),'membershipErrors':len(assessment['membershipErrors']),
        'plannedBusPhases':len(buses),
        'busPhasesStarted':sum(entry['solver']=='BusLanesPipelineSolver' for entry in progress['phases']),
        'rules':{key:captured['solverParams'][key] for key in ['minTraceWidth','minViaPadDiameter','minViaHoleDiameter','minViaEdgeToPadEdgeClearance','allowBlindAndBuriedVias','allowViaInPad']},
    }

boards = []
for board,title in BOARDS.items():
    before = board_result('baseline',board)
    after = board_result('candidate',board)
    for key in ['firstRegionRequestedConnections','inputSha256','sourceSha256','nonErrorCircuitSha256','rules']:
        assert before[key] == after[key],(board,key)
    assert before['acceptedTraces'] == after['acceptedTraces'] == before['acceptedVias'] == after['acceptedVias'] == 0
    assert before['geometryErrors'] == after['geometryErrors'] == before['membershipErrors'] == after['membershipErrors'] == 0
    boards.append({'board':board,'title':title,'before':before,'after':after})

paired = {}
for board,routed in [('icepi',7),('imx6',8)]:
    trials = read(f'paired/{board}/comparison.json')
    assert len(trials)==6
    assert len({row['inputSha256'] for row in trials}) == len({row['copperSha256'] for row in trials}) == 1
    full = next(row for row in boards if row['board']==board)
    assert trials[0]['inputSha256'] == full['before']['inputSha256']
    assert all(row['failed'] and not row['solved'] and row['bestPartial']['routed']==routed and row['iterations']==26131 for row in trials)
    assert all(row['copperDrc']['valid'] and not row['copperDrc']['issues'] and row['copperDrc']['checkedViaCount']==7 for row in trials)
    before = [row['elapsedMs'] for row in trials if row['revision']=='before']
    after = [row['elapsedMs'] for row in trials if row['revision']=='after']
    before_median,after_median = statistics.median(before),statistics.median(after)
    before_p95,after_p95 = quantile(before,.95),quantile(after,.95)
    assert after_median<before_median and after_p95<before_p95 and statistics.mean(after)<statistics.mean(before)
    paired[board] = {'beforeMs':before,'afterMs':after,'beforeMedianMs':before_median,'afterMedianMs':after_median,'medianReductionPercent':100*(1-after_median/before_median),'beforeP95Ms':before_p95,'afterP95Ms':after_p95,'p95ReductionPercent':100*(1-after_p95/before_p95),'beforeMeanMs':statistics.mean(before),'afterMeanMs':statistics.mean(after),'inputSha256':trials[0]['inputSha256'],'copperSha256':trials[0]['copperSha256'],'iterations':26131,'bestPartialRouted':routed,'requestedConnections':32,'throughVias':7,'independentCopperDrcIssues':0,'fullSolve':False}

guard = read('fanout31-matched.json')
original = next(row for row in guard['cohorts'] if row['cohort']=='matched/original')
fixed = next(row for row in guard['cohorts'] if row['cohort']=='matched/cleanup')
assert original['report']['commit'] == COMMITS['fanoutBaseline'] and fixed['report']['commit'] == COMMITS['measuredFix']
assert original['svgs'] == fixed['svgs'] and len(original['svgs']) == 30 and len(guard['inputs']) == 72
keys = ['status','routed','connections','vias','validatedBreakouts']
def outcomes(cohort):
    return {row['sample']:{key:row.get(key) for key in keys} for row in cohort['report']['rows']}
assert len(original['report']['rows'])==len(fixed['report']['rows'])==72 and outcomes(original)==outcomes(fixed)

isolated_cases = isolated_solved = 0
for board in BOARDS:
    pair = read(f'isolated/{board}.json')
    before = next(row['rows'] for row in pair if row['revision']=='before')
    after = next(row['rows'] for row in pair if row['revision']=='after')
    assert len(before)==len(after)
    for first,second in zip(before,after):
        for key in ['busId','inputSha256','status','copperSha256']:
            assert first[key]==second[key],(board,key)
        if second['status']=='solved':
            assert second['copperDrc']['valid'] and not second['copperDrc']['issues']
            isolated_solved += 1
    isolated_cases += len(before)
assert isolated_cases==349 and isolated_solved==292

proof = read('production-equivalence.json')
assert proof['generatedJavaScriptIdentical'] and proof['final']==COMMITS['fix'] and proof['measured']==COMMITS['measuredFix']
report = {'versions':VERSIONS,'commits':COMMITS,'boards':boards,'pairedNativeSearches':paired,'fanout31':{'cases':72,'solvedBefore':30,'solvedAfter':30,'timedOutBefore':42,'timedOutAfter':42,'allOutcomesIdentical':True,'identicalSolvedSvgs':30},'isolatedNativePlanes':{'cases':349,'acceptedBefore':292,'acceptedAfter':292,'failuresBefore':57,'failuresAfter':57,'allAcceptedCopperIdentical':True,'independentDrcIssues':0},'focused':{'warmSourcePortReadsBefore':2148,'warmSourcePortReadsAfter':3,'routeAndViaUnchanged':True},'cpuProfile':read('profile/summary.json'),'limits':['All six full boards remain blocked in fanout; no DDR bus phase starts.','First-region best partials are diagnostic search states, not accepted routes or connected full-board nets.','OrangeCrab and H616 are limited by the 600-second full-board budget; partial scores at that cutoff depend on assignments reached. OrangeCrab reached 20 assignments before and 19 after (122 vs118 partial connections), with zero accepted copper in both runs.','Paired native timings use three serial before/after pairs on one Blacksmith worker per scene, alternating order. P95 uses linear interpolation over these three runs.','Warm metadata reads measure candidate construction work; they are not a time measurement.']}
(ROOT/'analysis.json').write_text(json.dumps(report,indent=2)+'\n')
(ROOT/'provenance.json').write_text(json.dumps({'versions':VERSIONS,'commits':COMMITS,'baselineRun':'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44469791389','candidateAndMatchedBenchmarks':'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44471015833','validationAndIsolatedPlanes':'https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44473254235','workflow':'Saved routes removed; fanout → bus lanes → remaining routing; exact original footprints/placement and rules.','nativeProfileInput':paired['icepi']['inputSha256'],'nativeProfileMatchesFreshInput':True,'renderers':{'pcb':'circuit-to-svg0.0.460 from actual emitted CircuitJson','solver':'graphics-debug0.0.99 native GraphicsObject, white background'}},indent=2)+'\n')

namespace='http://www.w3.org/2000/svg'
ET.register_namespace('',namespace)
ns='{'+namespace+'}'
svg=ET.Element(ns+'svg',{'width':'2000','height':'4930','viewBox':'0 0 2000 4930'})
ET.SubElement(svg,ns+'rect',{'width':'2000','height':'4930','fill':'white'})
ET.SubElement(svg,ns+'text',{'x':'20','y':'32','font-size':'25','font-family':'sans-serif','fill':'#172033'}).text='Full native boards — tscircuit 0.0.3243 / core 0.0.2425 / fanout 0.0.89'
ET.SubElement(svg,ns+'text',{'x':'20','y':'65','font-size':'18','font-family':'sans-serif','fill':'#475569'}).text='Fresh routing: fanout → bus lanes → rest. 0/6 complete; no accepted traces or vias; DDR bus routing not reached.'
for row_index,row in enumerate(boards):
    for column,phase in enumerate(['baseline','candidate']):
        x,y=20+column*1000,95+row_index*800
        result=row['before' if column==0 else 'after']
        ET.SubElement(svg,ns+'text',{'x':str(x),'y':str(y+25),'font-size':'19','font-family':'sans-serif','fill':'#172033'}).text=f"{row['title']} — {'Before' if column==0 else 'After'}"
        ET.SubElement(svg,ns+'text',{'x':str(x),'y':str(y+53),'font-size':'15','font-family':'sans-serif','fill':'#475569'}).text=f"Fanout incomplete; best partial {result['bestPartialConnections']}/{result['firstRegionRequestedConnections']} (uncommitted); 0 accepted traces/vias"
        native=ET.parse(ROOT/'pcb'/phase/(row['board']+'.svg')).getroot()
        native.set('viewBox',f"0 0 {native.attrib['width']} {native.attrib['height']}")
        native.set('x',str(x));native.set('y',str(y+65));native.set('width','960');native.set('height','715')
        prefix=f"{row['board']}-{phase}-"
        ids={element.attrib['id']:prefix+element.attrib['id'] for element in native.iter() if 'id' in element.attrib}
        for element in native.iter():
            for key,text in list(element.attrib.items()):
                if key=='id':element.set(key,ids[text])
                else:
                    text=re.sub(r'url\(#([^)]+)\)',lambda match:'url(#'+ids.get(match.group(1),match.group(1))+')',text)
                    if text.startswith('#') and text[1:] in ids:
                        text='#'+ids[text[1:]]
                    element.set(key,text)
        svg.append(native)
ET.ElementTree(svg).write(ROOT/'all-boards.svg',encoding='unicode',xml_declaration=False)
page=['<!doctype html><meta charset="utf-8"><title>DDR full-board rerun2425</title><style>body{font:16px system-ui;max-width:1500px;margin:auto;padding:24px}img{max-width:100%}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}code{background:#eee}</style>', '<h1>Latest full-board rerun</h1>','<p>tscircuit 0.0.3243 / core 0.0.2425 / fanout 0.0.89. All six boards still fail fanout; no accepted copper or DDR bus routing. The fix reduces repeated candidate construction.</p>','<p><a href="analysis.json">Analysis and raw statistics</a> · <a href="all-boards.svg">Full before/after PCB SVG</a> · <a href="circuits-and-results.zip">TSX sources, SVGs and raw results</a></p>','<table><tr><th>Native search</th><th>Before median</th><th>After median</th><th>Reduction</th></tr>']
for board,measure in paired.items():page.append(f"<tr><td>{html.escape(BOARDS[board])}</td><td>{measure['beforeMedianMs']/1000:.1f}s</td><td>{measure['afterMedianMs']/1000:.1f}s</td><td>{measure['medianReductionPercent']:.1f}%</td></tr>")
page.extend(['</table>','<h2>Native joint U22 search: unchanged partial copper</h2>','<table><tr><td><img src="paired/icepi/before.svg"></td><td><img src="paired/icepi/after.svg"></td></tr></table>','<h2>Focused native replay</h2>','<table><tr><td><img src="focused/before.svg"></td><td><img src="focused/after.svg"></td></tr></table>','<h2>All boards</h2>','<img src="all-boards.svg">'])
(ROOT/'index.html').write_text('\n'.join(page))
print(json.dumps({'paired':paired,'fanout31':report['fanout31'],'isolatedPlanes':report['isolatedNativePlanes'],'boards':[{k:row[k] for k in ['board','title']} for row in boards]},indent=2))
