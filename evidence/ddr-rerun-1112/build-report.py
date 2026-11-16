from pathlib import Path
import hashlib, html, json, shutil, statistics, zipfile

out = Path(__file__).parent
ids = ['orangecrab', 'h616', 'butterstick', 'glider', 'imx6', 'icepi']
models = Path('/workspace/ddr-refresh-1112/experiments/full-board-priority-analysis')
def read(path):
    return json.loads(path.read_text())

def summarize(root, board, mode):
    folder = root / 'full' / f'{board}-{mode}'
    process = read(folder / 'process.json')
    if not (folder / 'progress.json').exists():
        return dict(passed=False,status='hard_timeout_before_artifacts',initialCopperElements=None,
                    connectedNets=None,requestedNets=None,traces=None,vias=None,pours=None,
                    geometryErrors=None,membershipErrors=None,physicalFindings=None,phases=[],
                    errors=['Hard timeout before progress, assessment or PCB SVG was published'],
                    wallMs=process['wallMs'],peakRssMb=process['peakRssMb'],timedOut=process['timedOut'],
                    lastPipelineStage=None,phaseTimesMs={})
    progress = read(folder / 'progress.json')
    assessment = read(folder / 'assessment.json')
    diagnostic = read(folder / 'diagnostics.json')
    physical = {k:v for k,v in assessment['findings'].items() if k != 'routing'}
    passed = (progress['status'] == 'completed' and not process['timedOut']
              and assessment['connectedNets'] == assessment['routableNets']
              and not assessment['geometryErrors'] and not assessment['membershipErrors']
              and not any(physical.values()))
    pipeline = diagnostic.get('pipelineLastState') or {}
    return dict(passed=passed, status='hard_process_timeout' if process['timedOut'] else progress['status'], initialCopperElements=progress['initialCopperElements'],
                connectedNets=assessment['connectedNets'], requestedNets=assessment['routableNets'],
                traces=assessment['pcbTraces'], vias=assessment['vias'], pours=assessment['copperPours'],
                geometryErrors=assessment['geometryErrors'], membershipErrors=assessment['membershipErrors'],
                physicalFindings=physical, phases=progress['phases'],
                errors=list(dict.fromkeys(progress['errors'])), wallMs=process['wallMs'],
                peakRssMb=process['peakRssMb'], timedOut=process['timedOut'],
                lastPipelineStage=pipeline.get('stage'), phaseTimesMs=pipeline.get('times', {}))

rows=[]
for board in ids:
    source=read(models/board/'source.json')
    row=dict(id=board,title=source['title'],sourceSha256=hashlib.sha256((models/board/'source.json').read_bytes()).hexdigest(),tsxSha256=hashlib.sha256((models/board/'board.tsx').read_bytes()).hexdigest(),full={},ddr={})
    for variant,root in [('before',Path('/workspace/compact1112-base/before')/f'refresh1112-{board}'/'latest'),('after',Path('/workspace/compact1112-after/after')/f'endpoint-layers-{board}'/'final')]:
        ddr=read(root/'ddr/results.json')['cases'][0]
        row['ddr'][variant]={k:ddr[k] for k in ['status','wallMs','assessment']}
        for mode in ['phased','fanout']:
            result=summarize(root,board,mode)
            svg=root/'full'/f'{board}-{mode}'/'pcb.svg'
            if svg.exists():
                name=f'{board}-{mode}-{variant}.pcb.svg'
                shutil.copyfile(svg,out/name)
                result.update(svg=name,svgSha256=hashlib.sha256(svg.read_bytes()).hexdigest())
            else:
                result.update(svg=None,svgSha256=None)
            row['full'].setdefault(mode,{})[variant]=result
    rows.append(row)
state=read(out/'state.json')
paired=read(out/'paired-dataset18.json')
report=dict(versions=dict(tscircuit='0.0.3208',core='0.0.2399',autorouter='0.0.1112',fanout='0.0.84',busLanes='0.0.58'),state=state,ci=read(out/'ci-tests.json'),boards=rows,pairedDataset18=paired,
    selectedFix='Require shared physical copper layers when inferring endpoint pad aliases in Circuit JSON DRC conversion.',
    repro=dict(padCount=176,traceCount=85,declaredNets=4,beforeDrcNetGroups=1,afterDrcNetGroups=4,beforeFalseNetPairMerges=6,afterFalseNetPairMerges=0,falseNetPairMergeReductionPercent=100,beforeReportedIssues=23,afterReportedIssues=135,copperUnchanged=True),
    fullOrangeCrabInitialJointInput=dict(sameCapturedInput=True,routeCount=430,declaredNets=11,beforeDrcNetGroups=1,afterDrcNetGroups=11,beforeReportedIssues=290,afterReportedIssues=935),
    routedExamples=dict(bug107=read(out/'bug107-baseline-rescored.json'),bug109=read(out/'bug109-baseline-rescored.json')),srj23Sample50=read(out/'srj23-output-equivalence.json'),fanoutImx6=dict(before='Failed at 646.5s with 372 fresh pours and 3 physically complete nets',after='Killed at the 660s process cap before finalization; zero pours and zero complete nets',sameFanoutPreparation=dict(connections=32,terminals=44,obstacles=3212,aliases=1785132),routerNotReached=True),worker='blacksmith-8vcpu-ubuntu-2404-arm',bun='1.4.3',routingBudgetSeconds=600)
report['totals']={v:dict(ddrPassed=sum(b['ddr'][v]['status']=='passed' for b in rows),ddrConnectedNets=sum(b['ddr'][v]['assessment']['connectedNets'] for b in rows),ddrRequestedNets=sum(b['ddr'][v]['assessment']['requestedNets'] for b in rows),fullPhasedPassed=sum(b['full']['phased'][v]['passed'] for b in rows),fullFanoutPassed=sum(b['full']['fanout'][v]['passed'] for b in rows),assessedCases=sum(b['full'][m][v]['connectedNets'] is not None for b in rows for m in ['phased','fanout'])) for v in ['before','after']}
for b in rows:
    for mode in ['phased','fanout']:
        for variant in ['before','after']:
            r=b['full'][mode][variant]
            assert r['initialCopperElements'] in [0,None]
            assert not r['geometryErrors'] and not r['membershipErrors']
(out/'analysis.json').write_text(json.dumps(report,indent=2)+'\n')
escape=html.escape
table=''
cards=''
for b in rows:
    before=b['full']['phased']['before'];after=b['full']['phased']['after']
    ddr=b['ddr']['after']['assessment']
    error=after['errors'][0] if after['errors'] else after['status']
    failed_phase=next((p['name'] for p in reversed(after['phases']) if p.get('status')=='failed'),None)
    if failed_phase: error=f'{failed_phase}: {error}'
    table+=f'<tr><td><a href="#{b["id"]}">{escape(b["title"])}</a> · <a href="full-board-models/{b["id"]}/board.tsx">TSX</a></td><td>{ddr["connectedNets"]}/{ddr["requestedNets"]}</td><td>{before["connectedNets"]}/{before["requestedNets"]} → {after["connectedNets"]}/{after["requestedNets"]}</td><td>{before["traces"]} → {after["traces"]}</td><td>{escape(error)}</td></tr>'
    pictures=''
    for mode in ['phased','fanout']:
        pair=''
        for variant in ['before','after']:
            r=b['full'][mode][variant]
            if r['svg']:
                pair+=f'<div><h4>{variant.title()} · {r["connectedNets"]}/{r["requestedNets"]} complete nets</h4><a href="{r["svg"]}"><img loading="lazy" src="{r["svg"]}" alt="{escape(b["title"])} {mode} {variant}"></a><p>{r["traces"]} traces · {r["vias"]} vias · <a href="{r["svg"]}">Native PCB SVG</a></p></div>'
            else:
                pair+=f'<div><h4>{variant.title()} · no published SVG</h4><p>Process stopped before assessment and PCB publication.</p></div>'
        pictures+=f'<h3>{mode.title()} routing</h3><div class="pair">{pair}</div>'
    cards+=f'<section id="{b["id"]}"><h2>{escape(b["title"])}</h2>{pictures}<details><summary>Measured failures and validation</summary><pre>{escape(json.dumps(b["full"],indent=2))}</pre></details></section>'
timing='<table><tr><th>Dataset18 metric</th><th>Before</th><th>After</th><th>Time change</th></tr>'
for label,key in [('P50','p50TimeMs'),('P95','p95TimeMs'),('Mean','meanTimeMs')]:
    before=paired['summary']['base'][key];after=paired['summary']['fixed'][key]
    timing+=f'<tr><td>{label}</td><td>{before/1000:.3f}s</td><td>{after/1000:.3f}s</td><td>{(after/before-1)*100:+.2f}%</td></tr>'
timing+='</table>'
page=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Six DDR boards — router 1112 rerun</title><style>body{{font:16px/1.5 system-ui;margin:auto;max-width:1500px;padding:24px;color:#1e293b;background:#f4f6f8}}section{{background:white;padding:24px;margin:28px 0;border:1px solid #dbe0e8;border-radius:8px}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}img{{width:100%;height:auto;background:white}}a{{color:#1455a5}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #dbe0e8}}table{{border-collapse:collapse;width:100%;background:white}}pre{{overflow:auto;white-space:pre-wrap;font-size:12px}}.status{{border-left:5px solid #b7791f;background:#fff2d5;padding:16px}}@media(max-width:800px){{.pair{{grid-template-columns:1fr}}table{{font-size:12px}}}}</style><h1>Six DDR boards: latest merged sources and layer-aware DRC</h1><p><b>Final CI: 9/9 test shards pass; build, typecheck and format pass.</b> The repro and stacked fix are ready for review.</p><p>tscircuit 0.0.3208 · core 0.0.2399 · autorouter 0.0.1112 · fanout 0.0.84 · bus lanes 0.0.58.</p><p class="status"><b>DDR controls: {report['totals']['after']['ddrPassed']}/6, {report['totals']['after']['ddrConnectedNets']}/310 nets after the fix. Complete full boards: {report['totals']['before']['fullPhasedPassed']}/6 → {report['totals']['after']['fullPhasedPassed']}/6 in phased routing.</b> The selected fix corrects false electrical connections in DRC. It does not claim a routing-speed or full-board completion gain.</p><p>The full TSX models retain all original components, pad positions and net membership. Original tracks, vias and poured copper are removed; new pours are generated from plane intent. Each full-board solve uses the same 600-second budget on an 8-vCPU ARM Blacksmith runner. Connectivity is checked against physical pads, traces, via spans and generated polygons. SVGs contain actual partial emitted copper.</p><p><a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3874">Passing repro #3874</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3875">Stacked fix #3875</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/actions/runs/43964315562">Baseline</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/actions/runs/43967019925">Candidate and paired dataset18</a> · <a href="analysis.json">Measured analysis JSON</a> · <a href="circuits-and-pcb-results.zip">Download models and results</a></p><table><tr><th>Board</th><th>DDR nets</th><th>Full phased nets</th><th>Phased traces</th><th>Remaining blocker</th></tr>{table}</table><section><h2>Selected fix: preserve copper layers in endpoint connectivity</h2><p>DRC matched route endpoints to pads by X/Y alone. On OrangeCrab, assignable bottom-side ground pads joined eleven distinct plane nets into one DRC group, hiding conflicts and misleading repair. The fix requires a shared physical copper layer and preserves through-drill spans. Correct electrical identity is needed before repair quality can be trusted.</p><p>The passing repro uses a real 6 mm section from the new OrangeCrab run: 176 pads and 85 already-routed traces. It records one DRC net group before the fix and four after. All six false pairwise net merges are eliminated — a 100% reduction in this repro. The same snapshot path updates naturally in the stacked fix. Native copper geometry stays unchanged; colors show the groups DRC actually sees.</p><div class="pair"><div><h3>Before · 1/4 nets · 23 reported issues</h3><a href="orangecrab-drc-before.svg"><img src="orangecrab-drc-before.svg"></a></div><div><h3>After · 4/4 nets · 135 reported issues</h3><a href="orangecrab-drc-after.svg"><img src="orangecrab-drc-after.svg"></a></div></div><p>The higher issue count exposes existing violations. It is not a routing-completion improvement. In the full captured OrangeCrab joint-repair input, preserving all eleven nets changes the initial reported issue count from 290 to 935. An existing SRJ23 sample also exposes one previously hidden clearance error; its thirteen output traces are identical before and after. See <a href="srj23-output-equivalence.json">the copper equivalence evidence</a>.</p></section><section><h2>Routed examples</h2><p>Existing full-board tests reroute with the corrected DRC connectivity. The reading-lamp board retains all terminal pairs and has zero relaxed DRC issues under the corrected checker for both outputs; via entries change from 427 to 411. Rescoring the original 1726 board copper with the corrected checker exposes six hidden violations; the rerouted output has zero. It passes both declared-clearance and relaxed DRC, with via entries changing from 729 to 745. The original routed input is saved as <a href="bug107-original-routed-input.json.gz">compressed JSON</a>, with <a href="bug107-baseline-rescored.json">all six rescored errors</a>. These are updated native snapshots from the existing tests, with both variants retained for review.</p><h3>Reading-lamp board</h3><div class="pair"><div><h4>Before · 427 via entries</h4><img src="bug109-routed-before.svg"></div><div><h4>After · 411 via entries</h4><img src="bug109-routed-after.svg"></div></div><h3>1726 board</h3><div class="pair"><div><h4>Before · same corrected checker · 6 issues · 729 via entries</h4><img src="bug107-routed-before-rescored.svg"></div><div><h4>After · 745 via entries</h4><img src="bug107-routed-after.svg"></div></div></section><section><h2>Paired dataset18 validation</h2><p>All sixteen cases solve and pass relaxed DRC before and after, with 3,407 via entries in each version. All sixteen native PCB SVGs are byte-identical. Timings are slower in this paired run; no speed improvement is claimed.</p>{timing}<p><a href="paired-dataset18.json">All measured cases</a> · <a href="dataset18-svg-equivalence.json">Native SVG hashes</a></p></section>{cards}<section><h2>Remaining work</h2><p>OrangeCrab now publishes its plane phase: 430 traces and 271 vias, with 7/152 physically complete nets instead of 3/152. The board remains incomplete and fails physical DRC. i.MX6 fanout hit the 660-second hard process cap after the change, leaving no finalized pours; the baseline published 372 fresh pours before failing. Both runs were still in fanout preparation, with identical 3,212-obstacle input and no selected router stage reached. This timeout difference is retained in the results.</p><p>The full-board failures remain visible above: dense global plane pathing, joint DRC repair, power expansion, DDR surface approaches and fanout capacity. Internal plane candidates are not counted as emitted copper. A green evidence-collection job does not mean a full board routed successfully.</p></section></html>'''
(out/'index.html').write_text(page)
print(json.dumps(report['totals'],indent=2))

