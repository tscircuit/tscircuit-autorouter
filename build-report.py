import hashlib
import html
import json
import shutil
import statistics
from pathlib import Path

ROOT = Path(__file__).parent
SIDES = ("before", "after")
MODES = ("phased", "fanout")


def read(path):
    return json.loads(path.read_text())


def reduction(before, after):
    return 100 * (before - after) / before


def percentile(samples, fraction):
    ordered = sorted(samples)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    return ordered[lower] + (ordered[min(lower + 1, len(ordered) - 1)] - ordered[lower]) * (position - lower)


def pair(before, after, caption):
    return '<div class="pair">' + ''.join(
        f'<figure><figcaption>{side.title()} · {html.escape(caption)}</figcaption><a href="{path}"><img loading="lazy" src="{path}" alt="{side.title()} {html.escape(caption)}"></a></figure>'
        for side, path in [("before", before), ("after", after)]
    ) + '</div>'


def summarize(folder):
    assessment = read(folder / "assessment.json")
    progress = read(folder / "progress.json")
    process = read(folder / "process.json")
    diagnostics = read(folder / "diagnostics.json")
    assert not assessment["geometryErrors"] and not assessment["membershipErrors"]
    assert progress["initialCopperElements"] == 0
    physical = sum(count for kind, count in assessment["findings"].items() if kind != "routing")
    return {
        "connected": assessment["connectedNets"], "requested": assessment["routableNets"],
        "traces": assessment["pcbTraces"], "vias": assessment["vias"],
        "physicalFindings": physical, "findings": assessment["findings"],
        "status": progress["status"], "errors": list(dict.fromkeys(progress["errors"])),
        "passed": progress["status"] == "completed" and not process["timedOut"]
        and process["exitCode"] == 0 and assessment["connectedNets"] == assessment["routableNets"] and physical == 0,
        "diagnostics": diagnostics, "elapsedMs": progress["elapsedMs"],
        "runtime": progress["runtime"], "process": process,
    }


def main():
    manifest = read(ROOT / "full-board-models/manifest.json")
    provenance = read(ROOT / "provenance.json")
    kernel = read(ROOT / "paired-kernel.json")
    phases = read(ROOT / "paired-phases.json")
    dataset = read(ROOT / "interleaved-dataset18.json")
    icepi = read(ROOT / "icepi-matched-phases.json")
    assert len(icepi) == 2 and len({row["inputSha256"] for row in icepi}) == 1
    assert len({row["tracesSha256"] for row in icepi}) == 1
    assert all(row["solved"] and row["traceCount"] == 559 for row in icepi)
    assert len({row["outputSha256"] for row in kernel["measurements"]}) == 1
    assert len(phases) == 4 and len({row["tracesSha256"] for row in phases}) == 1
    assert len({row["inputSha256"] for row in phases}) == 1
    assert len(dataset) == 16 and all(row["beforeSolved"] and row["afterSolved"]
        and row["beforeDrcPassed"] and row["afterDrcPassed"] for row in dataset)
    assert all(row["beforeVias"] == row["afterVias"] and row["beforeSvgSha256"] == row["afterSvgSha256"] for row in dataset)
    timings = {}
    for side in SIDES:
        samples = [row[f"{side}Ms"] for row in dataset]
        timings[side] = {
            "kernelMedianMs": statistics.median(row["elapsedMs"] for row in kernel["measurements"] if row["variant"] == side),
            "phaseMedianMs": statistics.median(row["elapsedMs"] for row in phases if row["variant"] == side),
            "jointDrcMedianMs": statistics.median(row["stageTimesMs"]["pipeline9JointDrcRepairSolver"] for row in phases if row["variant"] == side),
            "datasetMeanMs": statistics.mean(samples), "datasetP50Ms": statistics.median(samples),
            "datasetP95Ms": percentile(samples, .95),
        }
    boards, controls = [], []
    for board in manifest:
        row = {**board, "modes": {}}
        for mode in MODES:
            row["modes"][mode] = {}
            for side in SIDES:
                folder = ROOT / "raw-results" / side / board["id"] / "full" / f'{board["id"]}-{mode}'
                result = summarize(folder)
                filename = f'{board["id"]}-{mode}-{side}.pcb.svg'
                shutil.copy2(folder / "pcb.svg", ROOT / filename)
                result.update(svg=filename, svgSha256=hashlib.sha256((ROOT / filename).read_bytes()).hexdigest())
                row["modes"][mode][side] = result
        pair_controls = {}
        for side in SIDES:
            case = read(ROOT / "raw-results" / side / board["id"] / "ddr/results.json")["cases"][0]
            assert case["status"] == "passed" and not any(case["assessment"]["findings"].values())
            pair_controls[side] = case["assessment"]
        comparable = ["requestedNets", "connectedNets", "pcbTraces", "vias", "wireLengthMm", "findings", "geometryErrors"]
        assert all(pair_controls["before"][key] == pair_controls["after"][key] for key in comparable)
        controls.append({"board": board["id"], **pair_controls})
        boards.append(row)
    totals = {side: {mode: {
        "cleanBoards": sum(board["modes"][mode][side]["passed"] for board in boards),
        "connectedNets": sum(board["modes"][mode][side]["connected"] for board in boards),
        "requestedNets": sum(board["modes"][mode][side]["requested"] for board in boards),
        "vias": sum(board["modes"][mode][side]["vias"] for board in boards),
        "physicalFindings": sum(board["modes"][mode][side]["physicalFindings"] for board in boards),
    } for mode in MODES} for side in SIDES}
    analysis = {"provenance": provenance, "timings": timings, "boards": boards, "totals": totals,
        "ddrControls": controls, "kernel": kernel, "matchedPhases": phases, "icepiMatchedPhases": icepi, "dataset18": dataset,
        "scope": "Clearance-preparation performance optimization; routing quality is assessed separately."}
    (ROOT / "analysis.json").write_text(json.dumps(analysis, indent=2) + "\n")
    timing_rows = ''.join(
        f'<tr><td>{label}</td><td>{timings["before"][key] / 1000:.3f} s</td><td>{timings["after"][key] / 1000:.3f} s</td><td>{reduction(timings["before"][key], timings["after"][key]):+.1f}%</td></tr>'
        for key, label in [("kernelMedianMs", "25 native searches · median of 7 alternating trials"),
            ("phaseMedianMs", "Complete OrangeCrab first phase · two runs per revision"),
            ("jointDrcMedianMs", "Joint DRC within those complete phases"),
            ("datasetMeanMs", "Dataset 18 mean"), ("datasetP50Ms", "Dataset 18 P50"), ("datasetP95Ms", "Dataset 18 P95")]
    )
    icepi_before = next(row for row in icepi if row["variant"] == "before")
    icepi_after = next(row for row in icepi if row["variant"] == "after")
    timing_rows += f'<tr><td>Complete iCE/Pi first phase · one matched pair</td><td>{icepi_before["elapsedMs"] / 1000:.3f} s</td><td>{icepi_after["elapsedMs"] / 1000:.3f} s</td><td>{reduction(icepi_before["elapsedMs"], icepi_after["elapsedMs"]):+.1f}%</td></tr>'
    table_rows, sections = [], []
    for board in boards:
        mode_sections = []
        for mode in MODES:
            before, after = [board["modes"][mode][side] for side in SIDES]
            table_rows.append(f'<tr class="mode-content" data-mode="{mode}"><td><a href="#board-{board["id"]}">{html.escape(board["title"])}</a></td>'
                f'<td>{before["connected"]}/{before["requested"]} → {after["connected"]}/{after["requested"]}</td><td>{before["traces"]} → {after["traces"]}</td>'
                f'<td>{before["vias"]} → {after["vias"]}</td><td>{before["physicalFindings"]} → {after["physicalFindings"]}</td><td>{"Clean" if after["passed"] else "Incomplete"}</td></tr>')
            details = ''.join(f'<p><b>{side.title()}</b>: {result["connected"]}/{result["requested"]} connected nets; {result["traces"]} traces; {result["vias"]} vias; '
                f'{result["physicalFindings"]} physical findings. {html.escape("; ".join(result["errors"]))}</p>' for side, result in [("before", before), ("after", after)])
            mode_sections.append(f'<div class="mode-content" data-mode="{mode}">{details}{pair(before["svg"], after["svg"], mode)}</div>')
        sections.append(f'<section id="board-{board["id"]}"><h2>{html.escape(board["title"])}</h2><p>{board["parts"]} components · {board["pads"]} pads · {board["nets"]} source nets. '
            f'<a href="full-board-models/{board["id"]}/board.tsx">Full TSX</a> · <a href="full-board-models/{board["id"]}/source.json">Native geometry and memberships</a></p>{"".join(mode_sections)}</section>')
    control_rows = ''.join(f'<tr><td>{row["board"]}</td><td>{row["before"]["connectedNets"]} → {row["after"]["connectedNets"]}</td><td>{row["before"]["vias"]} → {row["after"]["vias"]}</td><td>0 → 0</td></tr>' for row in controls)
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Six full-board reroutes · core 2410 / router 1124</title>
<style>body{{max-width:1500px;margin:auto;padding:28px;font:16px/1.55 system-ui;color:#172033;background:#f4f6f9}}section{{background:white;border:1px solid #d8dee9;border-radius:12px;padding:24px;margin:24px 0}}h1,h2{{line-height:1.2}}a{{color:#1756b4}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}figure{{margin:0}}figcaption{{font-weight:600;padding:12px 0}}img{{width:100%;border:1px solid #d8dee9;background:white}}table{{width:100%;border-collapse:collapse}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #dce2ec}}th{{background:#edf2f8}}.notice{{border-left:4px solid #c3821b;padding:12px;background:#fff7e9}}select{{padding:9px;font-size:16px}}pre{{overflow:auto;background:#edf1f7;padding:16px}}@media(max-width:800px){{body{{padding:12px}}.pair{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style>
<h1>Six full-board reroutes</h1><p>Frozen stack: tscircuit 0.0.3231 · core 0.0.2410 · autorouter 0.0.1124 · fanout 0.0.84 · bus lanes 0.0.62. After adds the focused clearance-preparation fix.</p>
<p><a href="circuits-and-pcb-results.zip">All circuits, native SVGs and evidence ZIP</a> · <a href="analysis.json">Measured analysis</a> · <a href="provenance.json">Revisions and runs</a> · <a href="https://github.com/tscircuit/repair04/pull/82">Repro #82</a> · <a href="https://github.com/tscircuit/repair04/pull/83">Fix #83</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3932">Router integration #3932</a></p>
<section><h2>Measured fix</h2><p>The completed OrangeCrab CPU profile places 323.4 seconds in joint DRC and 21.0 seconds in repeated connectivity lookups. Its 1,592 obstacles carry 479,296 aliases. Connectivity has already joined each obstacle’s nonempty aliases, so the existing clearance search now resolves one representative. Empty aliases retain their previous behavior.</p>
<p>The native repro drops from <b>471,649 to 1,590 alias resolutions: 99.7% fewer</b>. The path and all 57 search nodes remain identical. The full repair library passes 192 tests; the new regression compares 84 searches with the unchanged synchronous implementation.</p>
<table><tr><th>Measurement</th><th>Before</th><th>After</th><th>Time reduction</th></tr>{timing_rows}</table><p>Native search trials alternate order on one Blacksmith worker after warmup. Complete phases run before→after and after→before on one worker; all four emit the same 430-trace hash. Dataset 18 alternates adjacent sample order and retains 16/16 clean outputs with identical SVG hashes and via counts.</p>
{pair("snapshot-comparison/orangecrab-aliases-before.svg", "snapshot-comparison/orangecrab-aliases-after.svg", "native 20 × 20 mm clearance-search repro")}
<h2>Real routed before / after</h2><p>The full OrangeCrab output shown here remains incomplete. The completed first phase retains identical copper, including 430 traces and 271 vias; it still has 683 physical findings. The benefit is time saved in clearance preparation.</p>
{pair("snapshot-comparison/orangecrab-full-before.svg", "snapshot-comparison/orangecrab-full-after.svg", "full native OrangeCrab circuit · partial routing")}</section>
<section><h2>Whole-board results: 0/6 clean in both modes, before and after</h2><p>All six full circuits retain their component placements and complete net memberships. Original copper is removed before fresh routing: 49,583 tracks, 4,706 vias and 685 zones. Authored pour intent is regenerated. Both modes use a 600-second routing budget, a 660-second process limit and an independent physical audit on Blacksmith ARM workers.</p>
<label for="mode">Routing mode: </label><select id="mode"><option value="phased">Plane escapes → DDR buses → remaining signals</option><option value="fanout">Fanout → DDR buses → remaining signals</option></select>
<table><tr><th>Full circuit</th><th>Connected / requested nets</th><th>Traces</th><th>Vias</th><th>Physical findings</th><th>After</th></tr>{"".join(table_rows)}</table>
<p class="notice">A board passes only when rendering and the process finish, all routable nets connect, and physical findings are zero. Budgeted runs can stop before a phase publishes its copper; zero traces or zero findings on such a run do not establish a quality improvement. The separately completed matched phases check copper equivalence.</p>
<p>iCE/Pi’s budgeted phased run advances from 0 to 559 published traces and 344 vias, exposing 782 physical findings. A separate same-input comparison lets both revisions finish: both emit the identical 559-trace copper hash. The phase takes {icepi_before["elapsedMs"] / 1000:.3f} s before and {icepi_after["elapsedMs"] / 1000:.3f} s after on the same worker (one pair, {reduction(icepi_before["elapsedMs"], icepi_after["elapsedMs"]):.1f}% less time). Publication under a deadline also varies with runtime; the new visible findings are present in the completed baseline. This remains an incomplete board, rather than a measured routing-quality improvement. <a href="icepi-matched-phases.json">Completed iCE/Pi proof</a>.</p></section>
{"".join(sections)}
<section><h2>Original DDR controls</h2><p>These are the six smaller original DDR benchmark circuits. Their 310 requested nets remain fully connected with unchanged trace counts, via counts and wire lengths, and zero findings.</p><table><tr><th>Control</th><th>Connected nets</th><th>Vias</th><th>Physical findings</th></tr>{control_rows}</table>
{pair("snapshot-comparison/orangecrab-ddr-before.svg", "snapshot-comparison/orangecrab-ddr-after.svg", "clean OrangeCrab DDR control")}</section>
<section><h2>Remaining blockers</h2><p>The full circuits still encounter dense fanout escape failures, ButterStick’s port-point iteration limit, H616’s bus surface-approach geometry/matching failure, and long joint DRC or power expansion. Their measured state is retained in the raw assessments; the clearance-preparation optimization does not establish full-board routing success.</p></section>
<section><h2>Reproduce on Blacksmith</h2><p>Use Bun 1.4.3. Checkout core at <code>{provenance["coreCommit"]}</code> and the router at <code>{provenance["baselineRouter"]}</code> for before or <code>{provenance["candidateRouter"]}</code> for after, then run:</p><pre>cd full-board-models
bash reproduce.sh /absolute/router /absolute/core /absolute/results</pre><p>The models include all six full TSX circuits, extracted geometry, licenses, exact harness dependency lockfile and independent assessment. <a href="paired-kernel.json">Raw native timings and effective input hashes</a> · <a href="kernel-input-provenance.json">Native input provenance</a> · <a href="paired-phases.json">Completed OrangeCrab phase timings and copper hashes</a> · <a href="icepi-matched-phases.json">Completed iCE/Pi phase comparison</a> · <a href="interleaved-dataset18.json">All dataset 18 comparisons</a> · <a href="ci.json">Source validation</a></p></section>
<script>function showMode(){{for(const element of document.querySelectorAll('.mode-content'))element.style.display=element.dataset.mode===document.getElementById('mode').value?(element.tagName==='TR'?'table-row':'block'):'none'}}document.getElementById('mode').addEventListener('change',showMode);showMode()</script></html>'''
    (ROOT / "index.html").write_text(page)
    print(json.dumps({"totals": totals, "timings": timings}, indent=2))


if __name__ == "__main__":
    main()
