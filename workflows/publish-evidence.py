from pathlib import Path
from collections import Counter
import gzip,hashlib,html,json,re,shutil,statistics,subprocess,sys,xml.etree.ElementTree as ET,zipfile

ROOT=Path('report')
BOARDS={'orangecrab':'OrangeCrab rev 0.2.1 ECP5 DDR3','h616':'Allwinner H616 Devboard DDR3','butterstick':'ButterStick r1.0','glider':'Glider mainboard','imx6':'i.MX6 Demo Board','icepi':'iCE/Pi CM0 SBC'}
REPRO='5878835c6992da607a6df912bf97437830eb1275'
FIX='83f48db80349beecc505a72a6e1f3e36705c829f'
MEASURED='63f735cb2d5b3b93c5ec1f0d39ab607c3212594e'
BASE='5f568062b3f3ba6c2c16e43271eab6c1f7373d7d'

def read_json(relative: str):
    path=ROOT/relative
    if path.name.endswith('.gz'):
        serialized=gzip.decompress(path.read_bytes())
    else:
        serialized=path.read_bytes()
    return json.loads(serialized)

def matched_summary(board: str) -> dict:
    rows=read_json(f'paired/{board}/comparison.json')
    assert len(rows)==6 and len({row['inputSha256'] for row in rows})==1
    assert len({row['copperSha256'] for row in rows})==1
    assert all(row['copperDrc']['valid'] for row in rows)
    assert len({row['iterations'] for row in rows})==1
    result={}
    for phase in ['before','after']:
        selected=[row for row in rows if row['revision']==phase]
        times=[row['elapsedMs'] for row in selected]
        assert len(times)==3
        result[phase]={'elapsedMs':times,'medianMs':statistics.median(times),'p95Ms':statistics.quantiles(times,n=100,method='inclusive')[94],'meanMs':statistics.mean(times),'routed':selected[0]['bestPartial']['routed'],'vias':selected[0]['bestPartial']['vias'],'drcIssues':0}
    result['medianReductionPercent']=(1-result['after']['medianMs']/result['before']['medianMs'])*100
    result['inputSha256']=rows[0]['inputSha256']
    result['copperSha256']=rows[0]['copperSha256']
    result['scope']='Three serial matched native fanout search pairs on one Blacksmith8vcpuARM worker, alternating B/A,A/B,B/A. These searches finish with partial fanout failure. P95 is descriptive for three samples.'
    return result

def board_result(phase: str,board: str) -> dict:
    folder=f'{phase}/boards/{board}'
    p=read_json(folder+'/progress.json');d=read_json(folder+'/diagnostics.json');a=read_json(folder+'/assessment.json');plan=read_json(folder+'/plan.json')
    raw=gzip.decompress((ROOT/folder/'fanout-1-input.json.gz').read_bytes());srj=json.loads(raw)['solverParams'];state=d['fanoutLastState'];best=d['fanoutBestSummary']
    kinds=[entry['autorouter'] for entry in plan['plans']]
    assert max(i for i,k in enumerate(kinds) if k=='fanout')<min(i for i,k in enumerate(kinds) if k=='bus_lanes')
    assert max(i for i,k in enumerate(kinds) if k=='bus_lanes')<min(i for i,k in enumerate(kinds) if k=='auto_local')
    assert plan['initialCopperElements']==0
    c=read_json(folder+'/circuit.json.gz');without_errors=[e for e in c if not e['type'].endswith('_error')]
    return {'requested':len(srj['connections']),'bestRouted':best['routedConnectionCount'],'assignment':state['stats']['assignment'],'searchExhausted':state['failed'],'solved':state['solved'],'error':state['error'],'elapsedMs':p['elapsedMs'],'fanoutMs':p['phases'][0]['elapsedMs'],'inputSha256':hashlib.sha256(raw).hexdigest(),'sourceSha256':plan['sourceSha256'],'nonErrorCircuitSha256':hashlib.sha256(json.dumps(without_errors,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'acceptedTraces':a['pcbTraces'],'acceptedVias':a['vias'],'connectedNets':a['connectedNets'],'routableNets':a['routableNets'],'geometryErrors':len(a['geometryErrors']),'membershipErrors':len(a['membershipErrors']),'rules':{key:srj[key] for key in ['minTraceWidth','minViaPadDiameter','minViaHoleDiameter','minViaEdgeToPadEdgeClearance','allowBlindAndBuriedVias','allowViaInPad']}}

if sys.argv[1]=='prepare':
    ROOT.mkdir(exist_ok=True)
    names={'plan.json','progress.json','assessment.json','diagnostics.json','process.json','circuit.json','pcb.svg','worker.log','runtime-package.json','runtime-bun.lock'}
    for phase,prefix in [('baseline','published2417'),('candidate','geometry2417')]:
        for board in BOARDS:
            source=Path('captures')/phase/f'{prefix}-{board}'/board
            target=ROOT/phase/'boards'/board;target.mkdir(parents=True,exist_ok=True)
            for path in source.iterdir():
                if path.name not in names and not(path.name.startswith('fanout-') and path.name.endswith('.gz')):continue
                raw=path.read_bytes()
                if path.name=='circuit.json':
                    (target/'circuit.json.gz').write_bytes(gzip.compress(raw,compresslevel=9,mtime=0))
                    (target/'circuit-sha256.json').write_text(json.dumps({'uncompressedBytes':len(raw),'uncompressedSha256':hashlib.sha256(raw).hexdigest()},indent=2))
                else:shutil.copy2(path,target/path.name)
        source=Path('captures')/phase/f'{prefix}-fanout31';target=ROOT/phase/'fanout31';target.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source/'benchmark.json',target/'report.json')
        hashes={str(p.relative_to(source/'inputs')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (source/'inputs').rglob('*.json')}
        (target/'input-checksums.json').write_text(json.dumps(hashes,indent=2))
    shutil.copytree(Path('captures/candidate/geometry2417-paired-native'),ROOT/'paired/icepi')
    shutil.copytree(Path('captures/imx6'),ROOT/'paired/imx6')
    # The benchmark uploads raw reports before its compact log export is built.
    # Reconstruct that export from the preserved reports and exact trace bytes.
    for board in ['icepi','imx6']:
        folder=ROOT/'paired'/board
        comparison=[]
        for path in sorted(folder.rglob('report.json')):
            report=json.loads(path.read_text())
            comparison.append({'trial':path.parent.parent.name,'revision':path.parent.name,'elapsedMs':report['elapsedMs'],'inputSha256':report['inputSha256'],'copperSha256':hashlib.sha256((path.parent/'best-traces.json').read_bytes()).hexdigest(),'bestPartial':report['bestPartial'],'copperDrc':report['copperDrc'],'failed':report['failed'],'solved':report['solved'],'error':report['error'],'iterations':report['iterations']})
        assert len(comparison)==6
        (folder/'comparison.json').write_text(json.dumps(comparison,indent=2))

    shutil.copytree(Path('captures/baseline/published2417-native-profile'),ROOT/'baseline/native-profile')
    profile=ROOT/'baseline/native-profile/fanout.cpuprofile';raw=profile.read_bytes();Path(str(profile)+'.gz').write_bytes(gzip.compress(raw,compresslevel=9,mtime=0));profile.unlink()
    (profile.parent/'profile-sha256.json').write_text(json.dumps({'uncompressedBytes':len(raw),'uncompressedSha256':hashlib.sha256(raw).hexdigest()},indent=2))
    keep={'assess.ts','build-core.ts','connectivity.ts','core-runtime.d.mts','core-runtime.mjs','inspect-routing-workflow.tsx','jsx.d.ts','manifest.json','native-full-board.tsx','native-part.tsx','package.json','bun.lock','render.tsx','reproduce.sh','reproduce-candidate.sh','run-fanout-bus-first.ts','runtime.d.mts','runtime.mjs','source-audit.json','tsconfig.json'}
    sources=ROOT/'sources';sources.mkdir()
    for path in Path('legacy/full-board-models').iterdir():
        if path.is_dir():shutil.copytree(path,sources/path.name)
        elif path.name in keep:shutil.copy2(path,sources/path.name)
    for name in ['render.tsx','native-full-board.tsx','native-part.tsx']:
        shutil.copy2(Path('experiments/full-board-priority-analysis')/name,sources/name)
    for name,captured in [('package.json','runtime-package.json'),('bun.lock','runtime-bun.lock')]:
        shutil.copy2(ROOT/'baseline/boards/icepi'/captured,sources/name)
    for name in ['reproduce.sh','reproduce-candidate.sh']:
        path=sources/name;s=path.read_text().replace('d88899c9ac79cf48491a402b5e3643b3efabe373','83180d0881807ce08dc38b0cc226b9eb8fcca59d').replace('5d9e4a0630bebe77003ee31e0dfa5993ee22e394','1a16da2f74fc2c80712d52abb17254dd2a80e2c5').replace('65439fb38d1d86af15495553588cfe21b28a197a',MEASURED).replace("=='0.0.84'","=='0.0.86'").replace('d88899c9','83180d08').replace('5d9e4a06','1a16da2f')
        path.write_text(s)
    for folder in ['focused','pcb/baseline','pcb/candidate','workflows']:(ROOT/folder).mkdir(parents=True,exist_ok=True)
    for commit in [BASE,MEASURED,REPRO]:
        subprocess.run(['git','fetch','origin',commit,'--depth','1'],cwd='source-fanout',check=True)
    assert not subprocess.check_output(['git','diff',MEASURED,FIX,'--','lib'],cwd='source-fanout')
    patch=subprocess.check_output(['git','diff',BASE,MEASURED,'--','lib'],cwd='source-fanout')
    assert patch==subprocess.check_output(['git','diff',REPRO,FIX,'--','lib'],cwd='source-fanout')
    (ROOT/'production.patch').write_bytes(patch)
    (ROOT/'production-patch-check.json').write_text(json.dumps({'byteIdenticalProductionPatch':True,'sha256':hashlib.sha256(patch).hexdigest(),'baseline':BASE,'measuredFix':MEASURED,'finalFix':FIX},indent=2))
    (ROOT/'focused/before.svg').write_bytes(subprocess.check_output(['git','show',REPRO+':tests/__snapshots__/native-alias-clearance.snap.svg'],cwd='source-fanout'))
    shutil.copy2('source-fanout/tests/__snapshots__/native-alias-clearance.snap.svg',ROOT/'focused/after.svg')
    for path in Path('.github/workflows').glob('ddr2417-*.yml'):shutil.copy2(path,ROOT/'workflows'/path.name)
    for name in ['publish-evidence.py','render-published-evidence.ts','replay-native-plane-drop.ts']:
        shutil.copy2(Path('experiments/full-board-priority-analysis')/name,ROOT/'workflows'/name)
    sys.exit(0)

pairs={name:matched_summary(name) for name in ['icepi','imx6']}
assert read_json('baseline/native-profile/report.json')['inputSha256']==pairs['icepi']['inputSha256']
assert all(row['medianReductionPercent']>0 for row in pairs.values())
rows=[]
for board,title in BOARDS.items():
    before=board_result('baseline',board);after=board_result('candidate',board)
    for key in ['requested','inputSha256','sourceSha256','nonErrorCircuitSha256','rules']:assert before[key]==after[key],(board,key)
    assert before['geometryErrors']==after['geometryErrors']==before['membershipErrors']==after['membershipErrors']==0
    rows.append({'board':board,'title':title,'before':before,'after':after})
    assert hashlib.sha256((ROOT/'sources'/board/'source.json').read_bytes()).hexdigest()==before['sourceSha256']
reports={phase:read_json(f'{phase}/fanout31/report.json') for phase in ['baseline','candidate']}
assert read_json('baseline/fanout31/input-checksums.json')==read_json('candidate/fanout31/input-checksums.json')
for a,b in zip(reports['baseline']['rows'],reports['candidate']['rows']):
    assert a['sample']==b['sample'] and all(a[k]==b[k] for k in ['status','routed','validatedBreakouts','vias'])
svg_hashes={}
for phase,prefix in [('baseline','published2417'),('candidate','geometry2417')]:
    folder=Path('captures')/phase/f'{prefix}-fanout31'
    svg_hashes[phase]={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.glob('*.svg')}
assert svg_hashes['baseline']==svg_hashes['candidate'] and len(svg_hashes['baseline'])==30
(ROOT/'fanout31-svg-audit.json').write_text(json.dumps({'all30RoutedSvgsIdentical':True,'inputsIdentical':72,**svg_hashes},indent=2))
timings={}
for phase,report in reports.items():
    complete=[row['milliseconds'] for row in report['rows'] if row['status']=='solved']
    timings[phase]={'outcomes':dict(Counter(row['status'] for row in report['rows'])),'medianCompletedMs':statistics.median(complete),'meanCompletedMs':statistics.mean(complete)}
provenance={'tscircuit':'0.0.3235','core':'0.0.2417','coreCommit':'1a16da2f74fc2c80712d52abb17254dd2a80e2c5','router':'0.0.1128','routerCommit':'83180d0881807ce08dc38b0cc226b9eb8fcca59d','fanout':'0.0.86','fanoutCommit':BASE,'busLanes':'0.0.62','bun':'1.4.3','nativeFanoutPinnedCapacityDependency':'0.0.718','measuredFix':MEASURED,'finalFix':FIX,'repro':REPRO,'runs':{'baseline':44359066016,'candidate':44361796571,'pairedImx6':44364735570,'sourceCheck':44362902700,'svgAudit':44366001013},'routingBudgetMs':600000,'hardProcessBudgetMs':660000,'fanout31Concurrency':16,'fanout31TimeoutSeconds':120,'workflow':'fanout -> DDR buses -> remaining DDR -> board','allSixSourceAndInputHashesIdentical':True,'evidenceRebuiltFromImmutableActionsArtifacts':True}
analysis={'provenance':provenance,'pairedNative':pairs,'boards':rows,'fanout31':timings,'all30SolvedFanout31SvgsIdentical':True,'completeBoards':{'before':0,'after':0},'ddrBusPhasesStarted':{'before':0,'after':0},'bestFirstFanoutTotal':{phase:sum(row[phase]['bestRouted'] for row in rows) for phase in ['before','after']},'firstFanoutRequests':sum(row['before']['requested'] for row in rows),'aliasProbe':{'before':33498,'after':132,'reductionPercent':(1-132/33498)*100},'fullBoardTimingLimitations':'One run per version on separate workers includes initialization and budget stops. The slower iMX6 whole-board observation is retained; matched native repeats isolate the changed component. Whole-board completion remains0/6.'}
(ROOT/'analysis.json').write_text(json.dumps(analysis,indent=2));(ROOT/'provenance.json').write_text(json.dumps(provenance,indent=2))
ice=pairs['icepi'];imx=pairs['imx6']
pair_rows=''.join(f"<tr><td>{BOARDS[name]}</td><td>{row['before']['medianMs']/1000:.1f}</td><td>{row['after']['medianMs']/1000:.1f}</td><td>{row['medianReductionPercent']:.1f}%</td><td>{row['before']['routed']} → {row['after']['routed']}</td><td>{row['before']['vias']} → {row['after']['vias']}</td></tr>" for name,row in pairs.items())
board_rows=''.join(f"<tr><td>{row['title']}</td><td>{row['before']['bestRouted']}/{row['before']['requested']}</td><td>{row['after']['bestRouted']}/{row['after']['requested']}</td><td>{row['before']['elapsedMs']/1000:.1f} → {row['after']['elapsedMs']/1000:.1f}</td><td>{row['before']['assignment']} → {row['after']['assignment']}</td></tr>" for row in rows)
sections=[]
for row in rows:
    board=row['board'];a=row['after']
    images=''.join(f'<figure><a href="pcb/{phase}/{board}.svg"><img loading="lazy" src="pcb/{phase}/{board}.svg" alt="{phase} {row["title"]}"></a><figcaption>{phase.title()}: full PCB after fanout failure; no new traces or vias accepted.</figcaption></figure>' for phase in ['baseline','candidate'])
    sections.append(f'<section><h2>{row["title"]}</h2><p>Best first fanout {row["before"]["bestRouted"]}/{a["requested"]} → {a["bestRouted"]}/{a["requested"]}. Whole-board connectivity remains {a["connectedNets"]}/{a["routableNets"]}.</p><div class="pair">{images}</div><p><a href="sources/{board}/board.tsx">Full TSX</a> · <a href="sources/{board}/source.json">All parts, pads and nets</a> · <a href="candidate/boards/{board}/circuit.json.gz">Circuit JSON.gz</a> · <a href="candidate/boards/{board}/diagnostics.json">Diagnostics</a></p></section>')
page=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Six-board DDR analysis: geometry-first fanout clearance</title>
<style>body{{max-width:1450px;margin:auto;padding:28px;font:16px/1.55 system-ui;background:#f4f6f9;color:#172033}}section{{background:white;border:1px solid #d8dee9;border-radius:12px;padding:24px;margin:24px 0}}a{{color:#1756b4}}table{{border-collapse:collapse;width:100%}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #dce2ec}}th{{background:#edf2f8}}img{{width:100%;background:white;border:1px solid #d8dee9}}figure{{margin:0}}figcaption{{font-size:14px;color:#465469}}.status{{border-left:4px solid #b54a39;background:#fff3ef;padding:12px}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}@media(max-width:800px){{.pair{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style>
<h1>Latest six-board analysis: geometry-first fanout clearance</h1><p>18 November2026 · tscircuit0.0.3235 / core0.0.2417 / autorouter0.0.1128 / fanout0.0.86 · Original saved copper removed; fanout → DDR buses → remaining nets.</p>
<section><h2>{ice['medianReductionPercent']:.1f}% lower native iCE/Pi fanout median</h2><p>The fix moves the existing exact segment-distance predicate ahead of alias scans. The fresh CPU profile attributes23.2% of sampled time to those scans. Nearby obstacles retain all ownership, component-body and source-pad exemptions. No new solver, cache or geometry rules.</p><p class="status"><strong>All six full boards still stop in fanout.</strong> Completed boards remain0/6; DDR bus phases started remain0/12. The native partial routes below were not accepted into the final PCB.</p><table><tr><th>Three matched native search pairs</th><th>Before median,s</th><th>After median,s</th><th>Reduction</th><th>Partial routes</th><th>Vias</th></tr>{pair_rows}</table><p>Each scene uses three serial pairs on one Blacksmith worker, alternating order. All repeated native copper hashes match, with zero independent copper DRC issues. These are failed native searches with identical work and partial routes.</p></section>
<section><h2>Six full-board results, same600s routing budget</h2><table><tr><th>Board</th><th>Best fanout before</th><th>Best fanout after</th><th>Full elapsed before → after,s</th><th>Last assignment/256</th></tr>{board_rows}</table><p>Counts are actual best assignments, including at timeout, and refer to first-region escapes rather than complete nets. Whole-board timings include initialization and run on separate workers. OrangeCrab/H616 still hit the budget. Glider now exhausts256 assignments rather than stopping after69.</p><p>The first i.MX6 whole-board observation was418.2 →498.1s. Subsequent matched native repeats are{imx['before']['medianMs']/1000:.1f} →{imx['after']['medianMs']/1000:.1f}s. Both observations are retained; native repeats isolate the changed checker. Whole-board completion remains0/6.</p></section>
<section><h2>Focused native repro:99.6% fewer alias reads</h2><p>The captured U22 path uses the original0.45/0.2mm through-via and0.1mm clearance. The test restores its counters before rendering and DRC and asserts exact copper equality. The stacked fix updates the same SVG count:33,498 →132.</p><div class="pair"><figure><img src="focused/before.svg" alt="Focused before"><figcaption>Before-only native repro.</figcaption></figure><figure><img src="focused/after.svg" alt="Focused after"><figcaption>After: identical path and via.</figcaption></figure></div></section>
<section><h2>Actual complete native U22 search before/after</h2><p>These are best partial routes from the full-board input:7/32 escapes, seven vias, zero copper DRC issues in every repeat. Labels show measured three-run medians; geometry is identical.</p><div class="pair"><figure><img src="paired/icepi/before.svg" alt="Native before"></figure><figure><img src="paired/icepi/after.svg" alt="Native after"></figure></div><p><a href="paired/icepi/comparison.json">All iCE/Pi repeats</a> · <a href="paired/imx6/comparison.json">All i.MX6 repeats</a></p></section>
<section><h2>Regression checks</h2><p>Fanout31 remains30/72 solved and42 timeouts. All72 inputs, outcomes, routed counts, validated breakouts and via counts match. All30 solved SVGs are byte-identical. Guard budget:16 workers/32 Blacksmith vCPUs,120s per case. Completed-case unpaired median46.26 →46.34s is separate from matched native timing.</p><p>All six full PCB records excluding error entities match. Geometry and net-membership audits have zero errors. Empty full-PCB physical findings reflect zero accepted traces; nonempty native replays and30 solved guard boards supply the routed-copper checks. Nearby-obstacle controls preserve foreign-pad rejection, exact circular clearance, rotated pads, direct/same-net permissions and terminal-body escapes.</p><p><a href="fanout31-svg-audit.json">Routed SVG checksums</a> · <a href="analysis.json">Complete statistics</a> · <a href="provenance.json">Exact source revisions and runs</a></p></section>
{''.join(sections)}
<section><h2>Sources and reproduction</h2><p><a href="https://github.com/tscircuit/fanout-solver/pull/293">Before-only repro#293</a> · <a href="https://github.com/tscircuit/fanout-solver/pull/294">Stacked fix#294</a> · <a href="all-boards.svg">All six PCB SVGs in one sheet</a> · <a href="sources/reproduce-candidate.sh">Reproduce before/after</a> · <a href="circuits-and-results.zip">Sources and results ZIP</a></p><p>All parts, pads, nets, layers, clearances, via rules and0.7mm breakout padding are unchanged. Raw Circuit JSON and CPU profile are losslessly gzipped with uncompressed checksums. Evidence was rebuilt from immutable successful Actions artifacts after the interactive workspace became unavailable.</p></section></html>'''
for a,b in {'November2026':'November 2026','tscircuit0':'tscircuit 0','core0':'core 0','autorouter0':'autorouter 0','fanout0':'fanout 0','attributes23':'attributes 23','remain0':'remain 0','median,s':'median, s','same600s':'same 600 s','after,s':'after, s','exhausts256':'exhausts 256','after69':'after 69','was418.2 →498.1s':'was 418.2 → 498.1 s','are'+f"{imx['before']['medianMs']/1000:.1f}":'are '+f"{imx['before']['medianMs']/1000:.1f}",' →'+f"{imx['after']['medianMs']/1000:.1f}"+'s':' → '+f"{imx['after']['medianMs']/1000:.1f}"+' s','repro:99.6':'repro: 99.6','original0.45/0.2mm':'original 0.45/0.2 mm','and0.1mm':'and 0.1 mm','count:33,498 →132':'count: 33,498 → 132','input:7/32':'input: 7/32','remains30/72':'remains 30/72','and42':'and 42','All72':'All 72','All30':'All 30','budget:16':'budget: 16','vCPUs,120s':'vCPUs, 120 s','median46.26 →46.34s':'median 46.26 → 46.34 s','and30':'and 30','repro#293':'repro #293','fix#294':'fix #294','and0.7mm':'and 0.7 mm'}.items():page=page.replace(a,b)
(ROOT/'index.html').write_text(page)
NS='http://www.w3.org/2000/svg';ET.register_namespace('',NS);sheet=ET.Element('{'+NS+'}svg',width='2000',height='4900',viewBox='0 0 2000 4900')
ET.SubElement(sheet,'{'+NS+'}rect',width='2000',height='4900',fill='white')
title=ET.SubElement(sheet,'{'+NS+'}text',x='30',y='42',fill='#0f172a',style='font:28px sans-serif');title.text='Six full PCB results — all remain blocked in fanout (0/6 complete)'
for index,row in enumerate(rows):
    y=80+index*800
    label=ET.SubElement(sheet,'{'+NS+'}text',x='30',y=str(y+25),fill='#0f172a',style='font:22px sans-serif');label.text=row['title']+' — best first fanout '+str(row['before']['bestRouted'])+'/'+str(row['before']['requested'])+' → '+str(row['after']['bestRouted'])+'/'+str(row['after']['requested'])
    for column,phase in enumerate(['baseline','candidate']):
        label=ET.SubElement(sheet,'{'+NS+'}text',x=str(30+column*1000),y=str(y+62),fill='#475569',style='font:18px sans-serif');label.text=phase.title()+': no newly accepted traces or vias'
        drawing=ET.fromstring((ROOT/'pcb'/phase/(row['board']+'.svg')).read_text())
        prefix=phase+'-'+row['board']+'-'
        ids={node.attrib['id']:prefix+node.attrib['id'] for node in drawing.iter() if 'id' in node.attrib}
        for node in drawing.iter():
            for key,old_attribute in list(node.attrib.items()):
                changed=old_attribute
                if key=='id':
                    changed=ids[old_attribute]
                else:
                    if 'url(#' in changed:
                        changed=re.sub(r'url\(#([^)]*)\)',lambda match:'url(#'+ids[match.group(1)]+')',changed)
                    if key.endswith('href') and changed.startswith('#') and changed[1:] in ids:
                        changed='#'+ids[changed[1:]]
                node.set(key,changed)
            if node.tag.endswith('style') and node.text and 'url(#' in node.text:
                node.text=re.sub(r'url\(#([^)]*)\)',lambda match:'url(#'+ids[match.group(1)]+')',node.text)
        if 'viewBox' not in drawing.attrib:
            drawing.set('viewBox','0 0 '+drawing.attrib['width'].removesuffix('px')+' '+drawing.attrib['height'].removesuffix('px'))
        drawing.set('x',str(20+column*1000));drawing.set('y',str(y+80));drawing.set('width','960');drawing.set('height','650');sheet.append(drawing)
ET.ElementTree(sheet).write(ROOT/'all-boards.svg',encoding='unicode')
for link in re.findall(r'(?:href|src)="([^"]+)"',page):
    if not link.startswith('https://') and link!='circuits-and-results.zip':assert (ROOT/link).is_file(),link
for path in ROOT.rglob('*.svg'):
    text=path.read_text();ET.fromstring(text);assert 'NaN' not in text and 'Infinity' not in text
manifest=[{'path':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name not in ['circuits-and-results.zip','file-manifest.json']]
(ROOT/'file-manifest.json').write_text(json.dumps(manifest,indent=2))
with zipfile.ZipFile(ROOT/'circuits-and-results.zip','w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for row in manifest:archive.write(ROOT/row['path'],row['path'])
    archive.write(ROOT/'file-manifest.json','file-manifest.json')
with zipfile.ZipFile(ROOT/'circuits-and-results.zip') as archive:
    assert archive.testzip() is None
    for row in manifest:assert hashlib.sha256(archive.read(row['path'])).hexdigest()==row['sha256']
print('EVIDENCE_VALIDATED',json.dumps({'files':len(manifest),'zipBytes':(ROOT/'circuits-and-results.zip').stat().st_size,'paired':pairs}))
