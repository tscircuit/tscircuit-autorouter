from pathlib import Path
import json,shutil,subprocess,gzip,collections,hashlib
artifact=Path('audited-results');report=Path('report');harness=Path('harness/experiments/e2e-samples-20261120')
folder=report/'experiments/e2e-samples-20261120/interception-results/compact-boundary-handoffs'
folder.mkdir(parents=True,exist_ok=True)
shutil.copytree(artifact,folder,dirs_exist_ok=True)
for src,dst in [('refresh2461-publication-verification.json','publication-verification.json'),('refresh2461-experiment-results-final.json','experiment-results.json'),('audit-compact-boundary2461.ts','audit-compact-boundary2461.ts'),('audit-geometry2461.py','audit-geometry2461.py')]:
    shutil.copyfile(harness/src,folder/dst)
published=json.loads((artifact/'published/statistics.json').read_text())
stacked=json.loads((artifact/'stacked/statistics.json').read_text())
assert len(published)==len(stacked)==10
assert all(r['inputsEqual'] and r['circuitGeometryAndNetsEqual'] and r['nativeDrc']==[True,True] and r['independentDrillViolations']==[0,0] and r['independentViaPadClearanceViolations']==[0,0] and r['sourceNetMismatchPairs']==[0,0] for r in published+stacked)
summary='';totals={}
for label,rows in [('Latest published stack',published),('Stacked on source-track candidates (#379)',stacked)]:
    before=sum(r['before'] for r in rows);after=sum(r['after'] for r in rows)
    vias=[sum(r['vias'][i] for r in rows) for i in [0,1]]
    boards=[sum(r['fullCircuitStatus'][i]=='complete' for r in rows) for i in [0,1]]
    length=[sum(r['wireLengthMm'][i] for r in rows) for i in [0,1]]
    totals[label]={'before':before,'after':after,'rawImprovementPercent':100*(after-before)/before,'vias':vias,'wireLengthMm':length,'fullBoards':boards}
    summary+=f"### {label}: actual full Core pipeline\n\nRaw partial first-region escapes: **{before} → {after} (+{100*(after-before)/before:.1f}%)** of 1,024. Partial fanout vias: **{vias[0]} → {vias[1]}**. Full boards: **{boards[0]}/10 → {boards[1]}/10**.\n\n"
    summary+='| Circuit | Pad escapes before → after | Vias before → after | Completed assignments | Same assignment prefix? | Best on common completed layer assignments |\n|---|---:|---:|---:|---|---:|\n'
    for r in rows:
        common=r['commonAssignmentBest']
        value='n/a' if common is None else f"{common[0]} → {common[1]} ({r['commonAssignmentCount']} shared)"
        summary+=f"| {r['sample']} | {r['before']} → {r['after']} | {r['vias'][0]} → {r['vias'][1]} | {r['assignments'][0]} → {r['assignments'][1]} | {r['sameAssignmentPrefix']} | {value} |\n"
    summary+='\nRaw outcomes include the effect of the unchanged wall-clock budget. Common layer assignments are matched by the complete sorted bus-to-layer mapping, not by assignment index when histories differ. The dedicated-via control below completes 256 assignments on both sides and isolates the routing effect.\n\n'
summary+='All full PCB SVGs remain unchanged because failed fanout copper is not committed. These are actual Core PCB outputs, not partial fanout drawings.\n\n| Sample | Before PCB | After PCB | Partial fanout before/after |\n|---|---|---|---|\n'
for r in published:
    s=r['sample']
    summary+=f'| {s} | [SVG](published/full-boards/before/{s}.svg) | [SVG](published/full-boards/after/{s}.svg) | [before](stacked/{s}-before.svg) · [after](stacked/{s}-after.svg) |\n'
summary+='\n| Native routed iCE/Pi region before | After |\n|---|---|\n| ![Before](stacked/icepi-spaced-before.svg) | ![After](stacked/icepi-spaced-after.svg) |\n\n'
locations=folder/'failure-locations';locations.mkdir(exist_ok=True)
for side in ['published','after']:
    for sample in [r['sample'] for r in published]:
        root=Path('captures-'+side)/('full-circuit-interception-'+sample)/sample
        load=lambda p:json.loads(gzip.decompress(p.read_bytes()) if str(p).endswith('.gz') else p.read_text())
        internals=load(root/'pipeline-internals.json')
        examples=dict(load(root/'fanout-rejection-examples.json.gz'))
        counters=sorted(internals['rejections'],key=lambda r:r['count'],reverse=True)
        selected=[];per_reason=collections.Counter()
        for counter in counters:
            reason=counter['reason'];key=counter['connection']+'|'+reason
            if per_reason[reason]>=2 or key not in examples:continue
            selected.append({'counter':counter,'geometry':examples[key]});per_reason[reason]+=1
        captured_report=load(root/'report.json')
        entry=next(s for s in captured_report['solvers'] if s['name']=='FanoutSolver')
        inputs=root/f"solver-{entry['id']}-input.json.gz"
        data={'sample':sample,'side':side,'constructorInputGzipSha256':hashlib.sha256(inputs.read_bytes()).hexdigest(),'operations':internals['operations'],'observerCallbackMs':internals['observerCallbackMs'],'topRejections':counters[:10],'actualRejectedGeometry':selected,'windingFailures':[s['error'] for s in captured_report['solvers'] if s['name']=='WindingBreakoutSolver' and s['failed']]}
        (locations/f'{sample}-{side}.json').write_text(json.dumps(data,indent=2)+'\n')
validation="""Full pipeline runs: [published baseline 45070654984](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45070654984), [#379 control 45074125683](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45074125683), [new fix 45080675519](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45080675519). Independent audit: [all-ten audit job](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45081031013/job/137389015423). The initial source-check job in that run exposed the inherited endpoint type error, which is corrected and verified by the separate exact-head check linked below. Native macOS repro: [45078894060](https://github.com/tscircuit/fanout-solver/actions/runs/45078894060); final fix: [45081283722](https://github.com/tscircuit/fanout-solver/actions/runs/45081283722). Exact-head full typecheck and repository format check: [45081325490](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45081325490).

The audit checks constructor equality, original circuit geometry/net membership, components/pads, original source-net aliases, native copper DRC, independent drill spacing and via/pad clearance, bus atomicity/layer/direction/via consistency, and endpoint/route validation. Pre-existing structural issues, if any, remain visible in statistics; no new structural issue is accepted. Gained/lost route identities, route length, vias, assignment histories, PCB hashes, winding failures and actual rejected geometry are retained.
"""
text=(harness/'compact-boundary-report-template.md').read_text().replace('<!-- FULL_PIPELINE_RESULTS -->',summary).replace('<!-- FINAL_VALIDATION -->',validation)
(folder/'analysis.md').write_text(text)
(folder/'totals.json').write_text(json.dumps(totals,indent=2)+'\n')
manifest={r['sample']:{'before':{'path':'published/full-boards/before/'+r['sample']+'.svg','sha256':r['pcbSha256'][0]},'after':{'path':'published/full-boards/after/'+r['sample']+'.svg','sha256':r['pcbSha256'][1]},'identical':r['pcbSvgEqual']} for r in published}
(folder/'full-board-artifacts.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('REPORT_TOTALS',json.dumps(totals))
subprocess.run(['git','config','user.name','github-actions[bot]'],cwd=report,check=True)
subprocess.run(['git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com'],cwd=report,check=True)
subprocess.run(['git','add','experiments/e2e-samples-20261120/interception-results/compact-boundary-handoffs'],cwd=report,check=True)
subprocess.run(['git','commit','-m','Report compact boundary handoffs with all-ten Core and physical audits'],cwd=report,check=True)
subprocess.run(['git','push','origin','HEAD:analysis/e2e-full-circuit-interception-results-20261120'],cwd=report,check=True)
print('REPORT_COMMIT',subprocess.check_output(['git','rev-parse','HEAD'],cwd=report,text=True).strip())
