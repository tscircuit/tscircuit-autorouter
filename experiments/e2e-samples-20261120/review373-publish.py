from pathlib import Path
import json,shutil,subprocess
artifact=Path('audited-results');report=Path('report');harness=Path('harness/experiments/e2e-samples-20261120')
folder=report/'experiments/e2e-samples-20261120/interception-results/shared-plane-via-reuse'
folder.mkdir(parents=True,exist_ok=True)
rows=json.loads((artifact/'statistics.json').read_text())
control=json.loads((harness/'review373-controlled-results.json').read_text())
assert len(rows)==10 and len(control['rows'])==10
assert all(r['inputsEqual'] and r['unchangedOriginalAssignmentPrefix'] for r in rows)
assert all(r['nativeDrc']==[True,True] and r['independentDrillViolations']==[0,0] and r['independentViaPadClearanceViolations']==[0,0] and r['sourceNetMismatchPairs']==[0,0] and r['unanchoredReuse']==[0,0] for r in rows)
assert all(not r['comparison']['lost'] and not r['comparison']['longer'] for r in control['rows'])
for path in artifact.iterdir():
 if path.is_dir():shutil.copytree(path,folder/path.name,dirs_exist_ok=True)
 else:shutil.copyfile(path,folder/path.name)
for name in ['review373-full-audit.ts','review373-controlled-results.json']:
 shutil.copyfile(harness/name,folder/name)
requested=sum(r['requested'] for r in rows)
before=sum(r['before'] for r in rows);after=sum(r['after'] for r in rows)
matched_before=sum(r['commonPrefixBest'][0] for r in rows);matched_after=sum(r['commonPrefixBest'][1] for r in rows)
vias_before=sum(r['vias'][0] for r in rows);vias_after=sum(r['vias'][1] for r in rows)
full_before=sum(r['fullCircuitStatus'][0]=='complete' for r in rows);full_after=sum(r['fullCircuitStatus'][1]=='complete' for r in rows)
percentage=100*(matched_after-matched_before)/matched_before
text=f'''# Reuse existing plane vias: reviewer follow-up to fanout #373

The reviewer correctly identified an unnecessary hole in the three-pad iCE/Pi example. The third GND pad can reach the first pad's existing via under the original manufacturing rules. The revised patch tries that existing via through the current straight/45-degree connector candidates and fixed-site plane router. It emits one source-layer trace to the owned via, rather than a duplicate drill or fabricated via token.

The focused native example now completes **3/3 requests using 2 vias**. The complete 32-request U22 region retains **23 escapes**, reduces **15 → 11 vias**, and shortens routed wire **33.51 → 29.86 mm** compared with the earlier PR implementation. The region still fails as a whole; these are partial escapes.

## Controlled comparison with the previous PR

[Replay run 45022398643](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45022398643) starts both implementations from exactly the same original best assignment in each of the ten full-circuit captures. It reruns only the final plane recovery pass, isolating this reviewer change from wall-clock assignment-search differences. Previous source: `c19eb7f80f2ddd7b9c21a07d87b8a6ae4c7b9f88`; prototype source: `ee0c50148fb4a8073022bda1c63e1a6902d4b8e7`. Production source `02d798e4357a39804f9744b059baabc3e94b4612` makes variable names clearer and updates the repro assertions/snapshots, with the same routing logic. Final reviewed head `6a87a557fc124b1ce29ffdd2a8a9d530127861e2` additionally updates the affected native ButterStick and U22 repro expectations; its production library is identical.

| Metric, identical captured assignments | Previous PR | Via reuse |
|---|---:|---:|
| Partial first-region escapes | 721/1,024 | 725/1,024 (+0.6%) |
| Physical vias in partial fanouts | 449 | 431 (−4.0%) |
| Total partial fanout wire | 2,390.71 mm | 2,369.79 mm (−0.9%) |
| Lost escapes / longer existing routes | — | 0 / 0 |
| Completed full boards | 0/10 | 0/10 |

All 19 extra vias introduced by the earlier recovery patch are replaced by reuse of existing vias. Four more requests escape; one of those new i.MX6 requests needs a new via, giving a net reduction of 18 vias. Relative to the captured published baseline, the complete revised recovery is **702 → 725 escapes (+3.3%)** with **430 → 431 vias**.

| Circuit | Escapes, previous PR → reuse | Vias | Wire, mm |
|---|---:|---:|---:|
'''
for r in sorted(control['rows'],key=lambda r:r['before']['sample']):
 a,b=r['before'],r['after'];text+=f"| {a['sample']} | {a['escapes']} → {b['escapes']} | {a['vias']} → {b['vias']} | {a['length']:.2f} → {b['length']:.2f} |\n"
text+=f'''
The ten replay jobs pass native copper DRC, original plane endpoint connectivity, structural validation, independent via/pad clearance, via-in-pad and drill separation, original CUI net identity, bus atomicity and serialized physical-via counts. Plans from the original captured assignments remain byte-for-byte intact. Every reused endpoint is checked against an actual owned via on the same electrical net, declared plane and source layer. [Full replay summaries](review373-controlled-results.json) retain each check and connection-level comparison.

## Fresh full-pipeline results

The original Blacksmith workflow was rerun from Core `c00a55255f10b52a1d39117ee35a636608c27abb`, using the exact revised source, in [45022986170](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45022986170). The original limits remain 256 assignments and 600 seconds, with the original preparation and external watchdog rules.

| Metric | Published baseline | Revised recovery |
|---|---:|---:|
| Escapes at common completed assignment work | {matched_before}/{requested} | {matched_after}/{requested} (+{percentage:.1f}%) |
| Raw best partial escapes | {before} | {after} |
| Physical vias in raw partial fanouts | {vias_before} | {vias_after} |
| Completed full circuits | {full_before}/10 | {full_after}/10 |

| Circuit | Requests | Raw escapes before → after | Vias | Assignments | Escapes at common work | Native SVGs |
|---|---:|---:|---:|---:|---:|---|
'''
for r in rows:
 s=r['sample'];text+=f"| {s} | {r['requested']} | {r['before']} → {r['after']} | {r['vias'][0]} → {r['vias'][1]} | {r['assignments'][0]} → {r['assignments'][1]} | {r['commonPrefixBest'][0]} → {r['commonPrefixBest'][1]} | [before]({s}-before.svg) · [after]({s}-after.svg) |\n"
text+='\nGlider spaced completes 36 → 35 assignments before timeout: raw best escapes are 137 → 135, with 9 before-only and 7 after-only requests; both runs reach 135 at common completed work. H616 spaced completes 193 assignments in both runs with 111 escapes. Timed cases are reported separately; the raw outputs are not described as equivalent completed work. Original assignment histories match exactly at every common completed prefix. The frozen comparison above isolates the via-reuse behavior. `statistics.json` retains raw gained/lost identities, all structural checks, length, circuit/pad counts, connected full-board nets and exact PCB hashes.\n'
text+='''
## Scope and failure locations

Only the ten uploaded original/spaced H616, ButterStick, Glider, i.MX6 and iCE/Pi full circuits are used. Archive SHA-256: `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`. All original components, pads, nets, widths, clearances, placements, fixed DDR placement, through-via and via-in-pad restrictions are preserved. Constructor arguments are equal before/after and source files are verified against the uploaded archive.

The published baseline remains tscircuit **0.0.3277**, Core **0.0.2458**, fanout **0.0.103**, capacity-autorouter **0.0.1152**, bus-lanes **0.0.65**, winding `08d8da9d8dbb037eba332e7bfd685063f8805ed4`. No release or bump workflow is duplicated. The previous [release verification and pipeline report](../shared-plane-drops/analysis.md) explains the bundled Node implementation.

The pipeline remains **fanout → DDR bus lanes → remaining routing**. All ten full boards still stop at their first incomplete fanout region. DDR bus lanes and remaining routing are not reached, and partial copper is not committed as a successful fanout. Full PCB SVGs and connected-board-net counts remain unchanged. The improvement is additional valid pad escapes with fewer holes; it does not complete a board.

The original observer captures static/mutual-clearance rejection sites, rejection geometry and completed assignments without changing decisions. Repeated accepted-route copper checks remain the principal rejection category in most regions; i.MX6 spaced remains dominated by pad/via restrictions. Rejection counts and preparation failures are retained in `statistics.json` and the raw run captures. The reviewer fix addresses a concrete missing candidate: a nearby same-net plane via already exists, but the recovery previously considered drilling another hole instead of connecting to it.

The ordinary assignment search is unchanged. Reuse is tried only in the existing final recovery pass; each complete bus either reuses existing vias for every connection or falls back to its owned-via candidate. A reuse candidate must pass the existing static/mutual checks, preserve the plane endpoint, avoid adding vias and avoid lengthening an available original candidate. The shortest valid existing connector wins. There is no new parallel solver, arbitrary radius/repair budget, global merge permission, placement change or relaxed manufacturing rule.

## Validation and visuals

[Repro #372](https://github.com/tscircuit/fanout-solver/pull/372) remains the base of [fix #373](https://github.com/tscircuit/fanout-solver/pull/373). Native focused and complete U22 SVG snapshots update naturally in the stacked fix. Existing performance repro assertions/snapshots are updated to the actual eleven-via output.

Exact-head type/format checks pass. All eight native macOS test shards pass in [45025005681](https://github.com/tscircuit/fanout-solver/actions/runs/45025005681). The [independent all-ten full-pipeline audit](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45023168296) passes constructor equality, original component/pad/net membership, CUI electrical-net identity, native copper DRC, independent pad/drill restrictions, physical reused-via ownership, bus atomicity, plane endpoints, route correctness and common-prefix assignment histories. Original geometry is retained for every equal-256-assignment comparison. Via and wire-length measurements are reported, including raw timed differences.

| Original focused repro | Revised fix |
|---|---|
| ![Before](https://raw.githubusercontent.com/tscircuit/fanout-solver/6efd3012706d5b6c4e9feb59ce320d8ed24f4f56/tests/__snapshots__/repro-native-plane-copper-contact.snap.svg) | ![After](https://raw.githubusercontent.com/tscircuit/fanout-solver/02d798e4357a39804f9744b059baabc3e94b4612/tests/__snapshots__/repro-native-plane-copper-contact.snap.svg) |

| Native iCE/Pi before | After |
|---|---|
| ![Before](icepi-original-before.svg) | ![After](icepi-original-after.svg) |

| Full-board PCB | Before | After |
|---|---|---|
'''
for r in rows:
 s=r['sample'];text+=f'| {s} | [PCB SVG](full-boards/before/{s}.svg) | [PCB SVG](full-boards/after/{s}.svg) |\n'
(folder/'analysis.md').write_text(text)
(folder/'totals.json').write_text(json.dumps({'requested':requested,'rawBefore':before,'rawAfter':after,'matchedBefore':matched_before,'matchedAfter':matched_after,'matchedImprovementPercent':percentage,'partialViasBefore':vias_before,'partialViasAfter':vias_after,'fullBoardsBefore':full_before,'fullBoardsAfter':full_after,'controlled':control['totals']},indent=2)+'\n')
manifest={r['sample']:{'before':{'path':'full-boards/before/'+r['sample']+'.svg','sha256':r['pcbSha256'][0]},'after':{'path':'full-boards/after/'+r['sample']+'.svg','sha256':r['pcbSha256'][1]},'identical':r['pcbSvgEqual']} for r in rows}
(folder/'full-board-artifacts.json').write_text(json.dumps(manifest,indent=2)+'\n')
subprocess.run(['git','config','user.name','github-actions[bot]'],cwd=report,check=True)
subprocess.run(['git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com'],cwd=report,check=True)
subprocess.run(['git','add','experiments/e2e-samples-20261120/interception-results/shared-plane-via-reuse'],cwd=report,check=True)
subprocess.run(['git','commit','-m','Report full-circuit plane via reuse and reviewer before/after evidence'],cwd=report,check=True)
subprocess.run(['git','push','origin','HEAD:analysis/e2e-full-circuit-interception-results-20261120'],cwd=report,check=True)
print('REPORT_COMMIT',subprocess.check_output(['git','rev-parse','HEAD'],cwd=report,text=True).strip())
print('REPORT_TOTALS',json.dumps(json.loads((folder/'totals.json').read_text())))
