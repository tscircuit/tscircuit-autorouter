from pathlib import Path
import collections,gzip,hashlib,json,shutil,subprocess
artifact=Path('audited-results')
report=Path('report')
harness=Path('harness/experiments/e2e-samples-20261120')
folder=report/'experiments/e2e-samples-20261120/interception-results/independent-boundary-handoffs'
folder.mkdir(parents=True,exist_ok=True)
shutil.copytree(artifact,folder,dirs_exist_ok=True)
shutil.copyfile(harness/'cleanup382-main-publication-proof.json',folder/'main-publication-proof.json')
shutil.copyfile(harness/'audit-independent-boundary382.ts',folder/'audit-independent-boundary382.ts')
shutil.copyfile(harness/'independent-boundary382-routing.patch',folder/'routing.patch')
rows=json.loads((artifact/'main/statistics.json').read_text())
assert len(rows)==10
assert all(r['inputsEqual'] and r['circuitGeometryAndNetsEqual'] and r['nativeDrc']==[True,True] and r['independentDrillViolations']==[0,0] and r['independentViaPadClearanceViolations']==[0,0] and r['sourceNetMismatchPairs']==[0,0] and r['structuralIssues']==[[],[]] for r in rows)
before=sum(r['before'] for r in rows)
after=sum(r['after'] for r in rows)
vias=[sum(r['vias'][i] for r in rows) for i in [0,1]]
length=[sum(r['wireLengthMm'][i] for r in rows) for i in [0,1]]
planes=[sum(r['planes'][i] for r in rows) for i in [0,1]]
boards=[sum(r['fullCircuitStatus'][i]=='complete' for r in rows) for i in [0,1]]
totals={'requested':sum(r['requested'] for r in rows),'escapes':[before,after],'escapeImprovementPercent':100*(after-before)/before,'vias':vias,'wireLengthMm':length,'wireLengthChangePercent':100*(length[1]-length[0])/length[0],'planeDrops':planes,'completedBoards':boards}
results=f"""| All ten full circuits, compared directly with main | Before | After |
|---|---:|---:|
| Raw partial first-region pad escapes | {before}/1,024 | {after}/1,024 (+{totals['escapeImprovementPercent']:.1f}%) |
| Vias in partial fanouts | {vias[0]} | {vias[1]} |
| Partial fanout trace length | {length[0]:.1f} mm | {length[1]:.1f} mm ({totals['wireLengthChangePercent']:+.1f}%) |
| Plane drops | {planes[0]} | {planes[1]} |
| Completed full boards | {boards[0]}/10 | {boards[1]}/10 |

These counts are pad-to-plane or pad-to-boundary escapes, not fully connected board nets. All ten full boards still stop at fanout; DDR bus lanes and remaining routing do not run. Full-board PCB outputs remain unchanged because partial fanout copper is not committed.

| Circuit | Escapes before → after | Vias before → after | Completed assignments | Best on common layer assignments |
|---|---:|---:|---:|---:|
"""
for r in rows:
    common=r['commonAssignmentBest']
    matched='n/a' if common is None else f"{common[0]} → {common[1]} ({r['commonAssignmentCount']} shared)"
    results+=f"| {r['sample']} | {r['before']} → {r['after']} | {r['vias'][0]} → {r['vias'][1]} | {r['assignments'][0]} → {r['assignments'][1]} | {matched} |\n"
results+="\nRaw results include the unchanged wall-clock budget. Shared assignments are matched by their complete sorted bus-to-layer mapping; an assignment index alone is not treated as equivalent work when histories differ. Statistics retain same-prefix checks, gained/lost connection identities and actual via/length changes.\n\n"
results+='| Sample | Before full PCB | After full PCB | Partial fanout |\n|---|---|---|---|\n'
for r in rows:
    name=r['sample']
    results+=f"| {name} | [SVG](main/full-boards/before/{name}.svg) | [SVG](main/full-boards/after/{name}.svg) | [before](main/{name}-before.svg) · [after](main/{name}-after.svg) |\n"
locations=folder/'failure-locations'
locations.mkdir(exist_ok=True)
for side in ['main','after']:
    for r in rows:
        sample=r['sample']
        root=Path('captures-'+side)/('full-circuit-interception-'+sample)/sample
        load=lambda p:json.loads(gzip.decompress(p.read_bytes()) if str(p).endswith('.gz') else p.read_text())
        internals=load(root/'pipeline-internals.json')
        examples=dict(load(root/'fanout-rejection-examples.json.gz'))
        counters=sorted(internals['rejections'],key=lambda counter:counter['count'],reverse=True)
        per_reason=collections.Counter()
        selected=[]
        for counter in counters:
            reason=counter['reason']
            key=counter['connection']+'|'+reason
            if per_reason[reason]>=2 or key not in examples:continue
            selected.append({'counter':counter,'geometry':examples[key]})
            per_reason[reason]+=1
        captured_report=load(root/'report.json')
        entry=next(s for s in captured_report['solvers'] if s['name']=='FanoutSolver')
        inputs=root/f"solver-{entry['id']}-input.json.gz"
        data={'sample':sample,'side':side,'constructorInputGzipSha256':hashlib.sha256(inputs.read_bytes()).hexdigest(),'operations':internals['operations'],'observerCallbackMs':internals['observerCallbackMs'],'topRejections':counters[:10],'actualRejectedGeometry':selected,'windingFailures':[s['error'] for s in captured_report['solvers'] if s['name']=='WindingBreakoutSolver' and s['failed']]}
        (locations/f'{sample}-{side}.json').write_text(json.dumps(data,indent=2)+'\n')
originals=[r for r in rows if r['sample'].endswith('-original')]
unchanged=[r['sample'] for r in originals if r['sameCompletedOutput']]
failure_summary=f"The main comparison retains {planes[0]} → {planes[1]} plane drops. H616 original has {next(r for r in rows if r['sample']=='h616-original')['planes'][0]} → {next(r for r in rows if r['sample']=='h616-original')['planes'][1]} plane drops. Exact unchanged original-region outputs: {', '.join(unchanged)}. Rejection counts are candidate checks, not counts of disconnected nets; selected actual collision geometry is published under [failure-locations](failure-locations/)."
before_sha='150228779f490eeb2dad3bb7fb63dc2673d1a9fa'
after_sha='c000bad2781ef331f3213cfe71e138b14adbe855'
image=lambda sha,suffix:f"https://raw.githubusercontent.com/tscircuit/fanout-solver/{sha}/tests/__snapshots__/repro-icepi-spaced-auto-handoffs{suffix}.snap.svg"
images='| Native before | Native after |\n|---|---|\n'
for suffix in ['', '-source-channels']:
    images+=f'| ![Before]({image(before_sha,suffix)}) | ![After]({image(after_sha,suffix)}) |\n'
validation="""Validation passed: [all-ten Core rerun](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45117573719), [independent physical audit](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45117702632), [main-based repro native macOS CI](https://github.com/tscircuit/fanout-solver/actions/runs/45119909119), and [independent fix native macOS CI](https://github.com/tscircuit/fanout-solver/actions/runs/45119935717).

The final-head [typecheck and format check](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45120056849) also pass.

The audit checks identical constructor inputs, original circuit geometry and net membership, components/pads, original source-net aliases, native copper DRC, independent via/pad and drill spacing, bus atomicity with consistent layer/direction/via use, and route endpoints. No new structural issue or physical clearance violation is accepted. PCB SHA-256 values and route identities are retained in the published statistics and manifest.
"""
text=(harness/'independent-boundary382-report-template.md').read_text().replace('<!-- RESULTS -->',results).replace('<!-- FAILURE_SUMMARY -->',failure_summary).replace('<!-- REPRO_IMAGES -->',images).replace('<!-- VALIDATION -->',validation)
assert '<!--' not in text
(folder/'analysis.md').write_text(text)
(folder/'totals.json').write_text(json.dumps(totals,indent=2)+'\n')
manifest={r['sample']:{'before':{'path':'main/full-boards/before/'+r['sample']+'.svg','sha256':r['pcbSha256'][0]},'after':{'path':'main/full-boards/after/'+r['sample']+'.svg','sha256':r['pcbSha256'][1]},'identical':r['pcbSvgEqual']} for r in rows}
(folder/'full-board-artifacts.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('REPORT_TOTALS',json.dumps(totals))
subprocess.run(['git','config','user.name','github-actions[bot]'],cwd=report,check=True)
subprocess.run(['git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com'],cwd=report,check=True)
subprocess.run(['git','add','experiments/e2e-samples-20261120/interception-results/independent-boundary-handoffs'],cwd=report,check=True)
subprocess.run(['git','commit','-m','Report independent main-based boundary fanout fix and all-ten PCB evidence'],cwd=report,check=True)
subprocess.run(['git','push','origin','HEAD:analysis/e2e-full-circuit-interception-results-20261120'],cwd=report,check=True)
print('REPORT_COMMIT',subprocess.check_output(['git','rev-parse','HEAD'],cwd=report,text=True).strip())
