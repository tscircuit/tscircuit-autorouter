from pathlib import Path
import json,shutil,subprocess
artifact=Path('audited-results');report=Path('report');harness=Path('harness/experiments/e2e-samples-20261120')
folder=report/'experiments/e2e-samples-20261120/interception-results/shared-plane-drops'
folder.mkdir(parents=True,exist_ok=True)
rows=json.loads((artifact/'statistics.json').read_text())
assert len(rows)==10
assert all(r['inputsEqual'] and r['unchangedOriginalAssignmentPrefix'] for r in rows)
assert all(r['nativeDrc']==[True,True] and r['independentDrillViolations']==[0,0] and r['independentViaPadClearanceViolations']==[0,0] and r['sourceNetMismatchPairs']==[0,0] for r in rows)
for path in artifact.iterdir():
 if path.is_dir():shutil.copytree(path,folder/path.name,dirs_exist_ok=True)
 else:shutil.copyfile(path,folder/path.name)
for name in ['publication-verification.json','audit-final-shared-plane2458.ts']:
 path=harness/name
 if path.exists():shutil.copyfile(path,folder/name)
requested=sum(r['requested'] for r in rows)
before=sum(r['before'] for r in rows);after=sum(r['after'] for r in rows)
matched_before=sum(r['commonPrefixBest'][0] for r in rows);matched_after=sum(r['commonPrefixBest'][1] for r in rows)
vias_before=sum(r['vias'][0] for r in rows);vias_after=sum(r['vias'][1] for r in rows)
full_before=sum(r['fullCircuitStatus'][0]=='complete' for r in rows);full_after=sum(r['fullCircuitStatus'][1]=='complete' for r in rows)
matched_gain=matched_after-matched_before
percentage=100*matched_gain/matched_before
raw_percentage=100*(after-before)/before
summary=f'''At common completed assignment prefixes, partial first-region escapes improve **{matched_before} → {matched_after} (+{percentage:.1f}%)** out of {requested} requests. Raw best results are **{before} → {after} (+{raw_percentage:.1f}%)**, with **{vias_before} → {vias_after}** vias in the partial fanouts. Completed full boards remain **{full_before}/10 → {full_after}/10**. The ordinary assignment histories are identical over every common completed prefix.

These counts measure pad-to-plane or pad-to-breakout escapes, not newly connected full-board logical nets. The global board copper and connected-net counts remain unchanged.

| Circuit | Requests in first region | Escapes before → after | Vias before → after | Completed assignments before → after | Best at common prefix | Fanout SVGs |
|---|---:|---:|---:|---:|---:|---|
'''
for r in rows:
 s=r['sample'];summary+=f"| {s} | {r['requested']} | {r['before']} → {r['after']} | {r['vias'][0]} → {r['vias'][1]} | {r['assignments'][0]} → {r['assignments'][1]} | {r['commonPrefixBest'][0]} → {r['commonPrefixBest'][1]} | [before]({s}-before.svg) · [after]({s}-after.svg) |\n"
summary+='\nOriginal/spaced budget differences are reported separately from routing gains. `statistics.json` retains the full per-case comparisons, route identities and hashes.\n\n'
summary+='| Full-board PCB | Before | After |\n|---|---|---|\n'
for r in rows:
 s=r['sample'];summary+=f'| {s} | [PCB SVG](full-boards/before/{s}.svg) | [PCB SVG](full-boards/after/{s}.svg) |\n'
summary+='\n| Routed iCE/Pi before | After |\n|---|---|\n| ![Before](icepi-original-before.svg) | ![After](icepi-original-after.svg) |\n'
ci='''Final validation passed: exact-head source type/format checks and all ten full-circuit jobs in [45013934138](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45013934138); independent all-ten audit [45014350188](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45014350188); native macOS eight-shard repro CI [45013663016](https://github.com/tscircuit/fanout-solver/actions/runs/45013663016) and fix CI [45013936224](https://github.com/tscircuit/fanout-solver/actions/runs/45013936224). The AM62L snapshots that changed in the rejected during-search prototype remain unchanged in the final fix.
'''
text=(harness/'shared-plane-report-template.md').read_text().replace('<!-- Measured all-ten results inserted here -->',summary).replace('<!-- Final CI and audit evidence inserted here -->',ci)
(folder/'analysis.md').write_text(text)
(folder/'totals.json').write_text(json.dumps({'requested':requested,'rawBefore':before,'rawAfter':after,'matchedBefore':matched_before,'matchedAfter':matched_after,'matchedImprovementPercent':percentage,'partialViasBefore':vias_before,'partialViasAfter':vias_after,'fullBoardsBefore':full_before,'fullBoardsAfter':full_after},indent=2)+'\n')
manifest={r['sample']:{'before':{'path':'full-boards/before/'+r['sample']+'.svg','sha256':r['pcbSha256'][0]},'after':{'path':'full-boards/after/'+r['sample']+'.svg','sha256':r['pcbSha256'][1]},'identical':r['pcbSvgEqual']} for r in rows}
(folder/'full-board-artifacts.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('REPORT_TOTALS',json.dumps(json.loads((folder/'totals.json').read_text())))
subprocess.run(['git','config','user.name','github-actions[bot]'],cwd=report,check=True)
subprocess.run(['git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com'],cwd=report,check=True)
subprocess.run(['git','add','experiments/e2e-samples-20261120/interception-results/shared-plane-drops'],cwd=report,check=True)
subprocess.run(['git','commit','-m','Report native full-circuit plane recovery with independent before/after audit'],cwd=report,check=True)
subprocess.run(['git','push','origin','HEAD:analysis/e2e-full-circuit-interception-results-20261120'],cwd=report,check=True)
print('REPORT_COMMIT',subprocess.check_output(['git','rev-parse','HEAD'],cwd=report,text=True).strip())
