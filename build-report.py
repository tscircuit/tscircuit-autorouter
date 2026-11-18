import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent


def read(path):
    return json.loads(path.read_text())


def main():
    manifest = read(ROOT / "full-board-models/manifest.json")
    by_id = {row["board"]: row for row in read(ROOT / "results-summary.json")}
    rows = [by_id[board["id"]] for board in manifest]
    cpu = read(ROOT / "fanout-profile/cpu-union.json")
    profile = read(ROOT / "fanout-profile/report.json")
    assert profile["failed"] and profile["error"].endswith("1/32 connections")
    assert len(rows) == 6 and all(row["busesStarted"] == 0 and row["busesCompleted"] == 0 for row in rows)
    assert all(row["traces"] == 0 and row["vias"] == 0 and not row["fanoutSolved"] for row in rows)
    assert all(not row["geometryErrors"] and not row["membershipErrors"] for row in rows)
    plane_fraction = 100 * cpu["unionInclusiveMs"]["routePlaneTerminatedBus"] / cpu["sampledMs"]
    includes_fraction = 100 * cpu["selfIncludesMs"] / cpu["sampledMs"]
    totals = {
        "boards": len(rows), "cleanBoards": 0, "fanoutsCompleted": 0,
        "plannedFanoutRegions": sum(row["fanoutPlans"] for row in rows),
        "plannedBusPhases": sum(row["busPlans"] for row in rows),
        "busPhasesStarted": 0, "busPhasesCompleted": 0,
        "connectedNets": sum(row["connectedNets"] for row in rows),
        "routableNets": sum(row["routableNets"] for row in rows),
        "publishedTraces": 0, "publishedVias": 0,
        "planeDropConnectionsInFirstFanouts": sum(row["planeDropConnections"] for row in rows),
        "lastAssignmentFailedPlaneBuses": sum(row["lastAssignmentFailedPlaneBuses"] for row in rows),
    }
    analysis = {
        "provenance": read(ROOT / "provenance.json"), "totals": totals, "boards": rows,
        "nativeIcepiReplay": profile, "sampledCpu": cpu,
        "priority": "Investigate off-pad local plane-drop generation and rejection in FanoutSolver before tuning downstream bus routing.",
        "scope": "Corrected workflow baseline. No production solver code changed. None of these runs reached bus lanes.",
    }
    (ROOT / "analysis.json").write_text(json.dumps(analysis, indent=2) + "\n")
    table, plane_table, sections = [], [], []
    for board, row in zip(manifest, rows):
        folder = ROOT / "raw-results" / board["id"]
        plan = read(folder / "plan.json")
        fanout_name = next(item["name"] for item in plan["plans"] if item["autorouter"] == "fanout")
        result = f'{row["bestRouted"]}/{row["fanoutConnections"]} best' if row["bestRouted"] is not None else f'{row["lastAssignmentRouted"]} last'
        outcome = "Layer assignments exhausted" if row["fanoutFailed"] else "600 s routing budget"
        table.append(f'<tr><td><a href="#board-{board["id"]}">{html.escape(board["title"])}</a></td><td>{html.escape(fanout_name)}</td>'
            f'<td>{result}</td><td>{row["lastAssignment"]}/{row["maxAssignments"]}</td><td>0/{row["busPlans"]}</td>'
            f'<td>{row["connectedNets"]}/{row["routableNets"]}</td><td>{outcome}</td></tr>')
        plane_table.append(f'<tr><td>{board["id"]}</td><td>{row["planeDropConnections"]}</td><td>{row["boundaryConnections"]}</td>'
            f'<td>{row["lastAssignmentFailedPlaneBuses"]}</td></tr>')
        previous = read(ROOT / "previous-results" / f'{board["id"]}.json')
        prior = previous["assessment"]
        phases = " → ".join(item["name"] for item in plan["plans"])
        error = html.escape(row["errors"][0])
        sections.append(f'''<section id="board-{board["id"]}"><h2>{html.escape(board["title"])}</h2>
<p>{board["parts"]} components · {board["pads"]} pads · {board["nets"]} source nets. <a href="full-board-models/{board["id"]}/board.tsx">Full TSX</a> · <a href="raw-results/{board["id"]}/plan.json">Verified phase plan</a> · <a href="raw-results/{board["id"]}/assessment.json">Independent assessment</a></p>
<p class="plan">{html.escape(phases)}</p><p class="failure">Fanout stopped: {error}</p>
<p><b>Current output: 0 published traces, 0 vias; DDR bus routing never started.</b> {row["connectedNets"]}/{row["routableNets"]} nets connected by the emitted physical geometry; the board remains incomplete.</p>
<figure><a href="{board["id"]}.pcb.svg"><img loading="lazy" src="{board["id"]}.pcb.svg" alt="{html.escape(board["title"])} full PCB layout after failed fanout"></a><figcaption>Full native PCB layout. Pads and fresh pours remain visible; no routed signal copper was accepted.</figcaption></figure>
<details><summary>Previous plane-first result for context</summary><p>The earlier run bypassed separate fanout, then attempted bulk plane routing before DDR buses. It published {prior["pcbTraces"]} traces and {prior["vias"]} vias, with {prior["connectedNets"]}/{prior["routableNets"]} connected nets. This is a different workflow and remains incomplete.</p><img loading="lazy" src="{board["id"]}-previous-plane-first.pcb.svg" alt="Previous plane-first partial output"></details></section>''')
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Corrected DDR workflow: fanout → buses → remaining nets</title>
<style>body{{max-width:1450px;margin:auto;padding:28px;font:16px/1.55 system-ui;background:#f4f6f9;color:#172033}}section{{background:white;border:1px solid #d8dee9;border-radius:12px;padding:24px;margin:24px 0}}h1,h2{{line-height:1.2}}a{{color:#1756b4}}table{{border-collapse:collapse;width:100%;font-size:15px}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #dce2ec}}th{{background:#edf2f8}}img{{width:100%;background:white;border:1px solid #d8dee9}}figure{{margin:0}}figcaption,.plan{{font-size:14px;color:#465469}}.failure{{border-left:4px solid #b54a39;background:#fff3ef;padding:12px}}.numbers{{font-size:21px;font-weight:650}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}summary{{cursor:pointer;font-weight:600}}details{{margin-top:22px}}pre{{white-space:pre-wrap;background:#edf2f8;padding:16px}}@media(max-width:800px){{body{{padding:12px}}.pair{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style>
<h1>Fanout → DDR buses → remaining nets</h1><p>The six full circuits were rerouted fresh on the unchanged published stack: tscircuit 0.0.3231 · core 0.0.2410 · autorouter 0.0.1124 · fanout 0.0.84 · bus lanes 0.0.62.</p>
<p><a href="circuits-and-results.zip">All circuits, SVGs and diagnostics ZIP</a> · <a href="analysis.json">Measured analysis</a> · <a href="provenance.json">Revisions and runs</a> · <a href="workflow-change.patch">Exact workflow change</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44296522072">Six-board Blacksmith run</a></p>
<section><h2>Result: fanout blocks every board</h2><p class="numbers">0/6 clean boards · 0/6 boards finish fanout · 0/{totals["plannedBusPhases"]} DDR bus phases start · 0 accepted traces or vias</p>
<p>Each job checked the actual core routing plan before solving: every BGA fanout precedes every DDR byte bus; all other routing follows. The bulk plane-first phase was removed. Original copper starts at zero, and all component/pad positions and full net memberships pass independent audits. No production solver code or fabrication rules changed; the pending fix PR is excluded.</p>
<table><tr><th>Full board</th><th>First fanout</th><th>Fanout routes</th><th>Assignments</th><th>Bus phases completed</th><th>Connected nets</th><th>Stop</th></tr>{"".join(table)}</table>
<p>“Best” is the completed solver’s reported best result. “Last” is the observed partial assignment at the deadline. Fanout routes include both local plane drops and boundary escapes. Connected-net counts do not mean DDR routing ran. A clean board requires every routable net connected and zero physical findings.</p></section>
<section><h2>Most useful next target: local plane drops inside fanout</h2><p>The first fanout inputs contain <b>{totals["planeDropConnectionsInFirstFanouts"]} plane-drop connections</b>. All {totals["lastAssignmentFailedPlaneBuses"]} plane buses are listed as failed in the last recorded assignments. These statistics describe those assignments; they are not complete searches for the two timed-out boards.</p>
<table><tr><th>Board</th><th>Local plane drops</th><th>Boundary connections</th><th>Plane buses failed in last assignment</th></tr>{"".join(plane_table)}</table>
<p>iCE/Pi is a small concrete repro: U22 has 32 routing requests, comprising 20 plane drops and 12 boundary connections. Its best complete search routes only one request, so at least 19 plane drops remain unrouted even in the best candidate. A direct replay of the exact captured input reproduces the same 1/32 result and 26,131 iterations.</p>
<p>The direct replay took {profile["elapsedMs"] / 1000:.3f} s with CPU profiling enabled. <b>{plane_fraction:.1f}% of sampled time</b> is inside <code>routePlaneTerminatedBus</code>, counting each sample once across all call contexts. Array membership checks consume {cpu["selfIncludesMs"] / 1000:.3f} s of self time ({includes_fraction:.1f}% of samples). The profile identifies both the failing work and an overhead hotspot; no speed improvement is claimed by this analysis.</p>
<p>The next focused investigation should isolate one rejected off-pad plane drop with the native BGA pads, opposite-layer obstacles, via spans and clearances. Determine which candidate-generation or validation condition rejects it before tuning downstream buses. The generic boundary-padding error does not establish that padding alone causes the failure: local plane drops fail too.</p>
<figure><a href="fanout-profile/icepi-u22.svg"><img loading="lazy" src="fanout-profile/icepi-u22.svg" alt="Native iCEPi U22 fanout debug crop"></a><figcaption>Native solver debug crop around U22. This is an unaccepted partial candidate, separate from the PCB output. <a href="fanout-profile/fanout.svg">Full native solver view</a> · <a href="fanout-profile/report.json">Replay result</a> · <a href="fanout-profile/cpu-union.json">CPU measurements without double counting</a></figcaption></figure></section>
{"".join(sections)}
<section><h2>What changed in this baseline</h2><p>The previous harness ran either plane-first without fanout, or fanout → planes → buses. This run uses fanout → byte0/byte1 buses → remaining DDR → all other nets, including bulk power/ground routing. Local plane drops are part of normal fanout. Native geometry, the 0.7 mm breakout padding, net membership, copper layers, via-in-pad prohibition and through-via rules are retained.</p>
<p>The run allows 600 seconds of routing and a 660-second process limit, then performs a separate physical audit. One full-board process runs on each 8-vCPU ARM Blacksmith worker. The previous six-board run used two processes per worker; elapsed times across those runs are not a paired speed comparison. The smaller passing DDR controls were not rerun or substituted for these full boards.</p>
<p>Existing PRs remain open and unchanged. This result establishes a corrected workflow baseline and a fanout investigation target.</p></section>
<section><h2>Reproduce</h2><p>Use the pinned source refs in <a href="provenance.json">provenance.json</a> and Bun 1.4.3 on Blacksmith. The exported full-board models contain all six TSX circuits, source geometry, exact harness dependency lockfile and licenses. Follow <a href="full-board-models/reproduce.sh">reproduce.sh</a> for the source builds and per-board plan, render and audit commands. The captured <code>fanout-1-input.json.gz</code> files include both native solver parameters and options.</p></section></html>'''
    (ROOT / "index.html").write_text(page)
    print(json.dumps({"totals": totals, "planeRoutingSamplePercent": plane_fraction, "includesSelfSamplePercent": includes_fraction}, indent=2))


if __name__ == "__main__":
    main()
