import hashlib
import html
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
MODES = ["phased", "fanout"]
SIDES = ["before", "after"]


def read(path):
    return json.loads(path.read_text())


def optional(name):
    path = ROOT / name
    return read(path) if path.exists() else None


def summarize(folder):
    assessment = read(folder / "assessment.json")
    progress = read(folder / "progress.json")
    process = read(folder / "process.json")
    diagnostics = read(folder / "diagnostics.json")
    assert not assessment["geometryErrors"] and not assessment["membershipErrors"]
    assert progress["initialCopperElements"] == 0
    physical = sum(count for kind, count in assessment["findings"].items() if kind != "routing")
    state = diagnostics.get("pipelineLastState") or {}
    return {
        "connected": assessment["connectedNets"], "requested": assessment["routableNets"],
        "traces": assessment["pcbTraces"], "vias": assessment["vias"],
        "physicalFindings": physical, "findings": assessment["findings"],
        "status": progress["status"], "errors": list(dict.fromkeys(progress["errors"])),
        "passed": progress["status"] == "completed" and not process["timedOut"]
        and process["exitCode"] == 0 and assessment["connectedNets"] == assessment["routableNets"] and physical == 0,
        "stage": state.get("stage"), "stageTimesMs": state.get("times", {}),
        "phases": progress["phases"], "elapsedMs": progress["elapsedMs"],
        "runtime": progress["runtime"], "process": process,
    }


def change(before, after):
    return 100 * (after / before - 1)


def pair(before, after, caption):
    return '<div class="pair">' + ''.join(
        f'<figure><figcaption>{side.title()} · {html.escape(caption)}</figcaption>'
        f'<a href="{svg}"><img loading="lazy" src="{svg}" alt="{side.title()} {html.escape(caption)}"></a></figure>'
        for side, svg in [("before", before), ("after", after)]
    ) + '</div>'


def timing_row(label, before_ms, after_ms, note=""):
    return (f'<tr><td>{html.escape(label)}</td><td>{before_ms / 1000:.3f} s</td>'
            f'<td>{after_ms / 1000:.3f} s</td><td>{change(before_ms, after_ms):+.1f}%</td>'
            f'<td>{html.escape(note)}</td></tr>')


def dataset_stats(report):
    before, after = report["beforeSummary"][0], report["afterSummary"][0]
    rows = report["rows"]
    assert len(rows) == 16 and all(row["beforeSolved"] and row["afterSolved"]
        and row["beforeDrcPassed"] and row["afterDrcPassed"] for row in rows)
    return {
        "samples": len(rows), "sameSvgCount": sum(row["beforeSvgSha256"] == row["afterSvgSha256"] for row in rows),
        "sameViaCount": sum(row["beforeVias"] == row["afterVias"] for row in rows),
        "meanMs": {"before": report["beforeMeanMs"], "after": report["afterMeanMs"]},
        "p50Ms": {"before": before["p50TimeMs"], "after": after["p50TimeMs"]},
        "p95Ms": {"before": before["p95TimeMs"], "after": after["p95TimeMs"]},
        "averageVias": {"before": before["avgVia"], "after": after["avgVia"]},
    }


def main():
    manifest = read(ROOT / "full-board-models/manifest.json")
    provenance = optional("provenance.json") or {}
    stage = read(ROOT / "paired-stage.json")
    forward = read(ROOT / "paired-dataset18.json")
    reverse = optional("reverse-paired-dataset18.json")
    adjacent = optional("interleaved-dataset18.json")
    matched = {side: read(ROOT / f"orangecrab-matched-{side}.json") for side in SIDES}
    assert matched["before"]["inputSha256"] == matched["after"]["inputSha256"]
    assert matched["before"]["tracesSha256"] == matched["after"]["tracesSha256"]
    assert all(row["outputSha256"] == stage["measurements"]["before"][0]["outputSha256"]
        for side in SIDES for row in stage["measurements"][side])
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
        for side in SIDES:
            case = read(ROOT / "raw-results" / side / board["id"] / "ddr/results.json")["cases"][0]
            assert case["status"] == "passed"
            assert not any(case["assessment"]["findings"].values())
            controls.append({"board": board["id"], "side": side, **case})
        boards.append(row)
    totals = {
        side: {mode: {
            "cleanBoards": sum(row["modes"][mode][side]["passed"] for row in boards),
            "connectedNets": sum(row["modes"][mode][side]["connected"] for row in boards),
            "requestedNets": sum(row["modes"][mode][side]["requested"] for row in boards),
            "vias": sum(row["modes"][mode][side]["vias"] for row in boards),
            "physicalFindings": sum(row["modes"][mode][side]["physicalFindings"] for row in boards),
        } for mode in MODES} for side in SIDES
    }
    dataset = {"beforeThenAfter": dataset_stats(forward),
               "afterThenBefore": dataset_stats(reverse) if reverse else None}
    if adjacent:
        dataset["adjacentSamples"] = {
            "samples": len(adjacent["rows"]),
            "sameSvgCount": sum(row["beforeSvgSha256"] == row["afterSvgSha256"] for row in adjacent["rows"]),
            "sameViaCount": sum(row["beforeVias"] == row["afterVias"] for row in adjacent["rows"]),
            **{metric: {side: adjacent["metrics"][side][metric] for side in SIDES}
               for metric in ["meanMs", "p50Ms", "p95Ms"]},
        }
    analysis = {"boards": boards, "totals": totals, "ddrControls": controls,
                "preparationStage": stage, "dataset18": dataset,
                "orangecrabMatchedPhase": matched, "provenance": provenance,
                "scope": "Preparation-time optimization; no full-board quality or global dataset18 speed improvement claimed."}
    (ROOT / "analysis.json").write_text(json.dumps(analysis, indent=2) + "\n")

    butter = next(row for row in boards if row["id"] == "butterstick")["modes"]["phased"]
    timing = timing_row("ButterStick isolated preparation stage · median of 3", stage["medianMs"]["before"],
        stage["medianMs"]["after"], "Same worker; all six output graph hashes identical")
    timing += timing_row("ButterStick full phased run", butter["before"]["elapsedMs"], butter["after"]["elapsedMs"],
        "Both runs still fail at port-point pathing")
    timing += timing_row("ButterStick preparation within full run",
        butter["before"]["stageTimesMs"]["necessaryCrampedPortPointSolver"],
        butter["after"]["stageTimesMs"]["necessaryCrampedPortPointSolver"], "Single full-board run per revision")

    dataset_rows = ""
    for label, stats in [("Before → after", dataset["beforeThenAfter"]), ("After → before", dataset["afterThenBefore"]),
                         ("Adjacent sample pairing", dataset.get("adjacentSamples"))]:
        if stats:
            for metric, description in [("meanMs", "Mean"), ("p50Ms", "P50"), ("p95Ms", "P95")]:
                dataset_rows += timing_row(f'{label} order · {description}', stats[metric]["before"], stats[metric]["after"],
                    f'{stats["sameSvgCount"]}/16 SVGs and {stats["sameViaCount"]}/16 via counts identical')
    reverse_note = ("Both execution orders are reported; end-to-end timings vary by run."
                    if reverse else "The reverse-order pair is pending and will be included when collected.")
    if adjacent:
        reverse_note += " Adjacent pairs alternate execution order per sample. Their mean changes by +0.7%, P50 by +0.6% and P95 by +0.1%; earlier whole-batch means rose 4.3–4.6%. These are retained below without a global speed claim."

    table_rows, sections = [], []
    for board in boards:
        for mode in MODES:
            before, after = [board["modes"][mode][side] for side in SIDES]
            table_rows.append(
                f'<tr class="mode-content mode-{mode}" data-mode="{mode}"><td><a href="#board-{board["id"]}">{html.escape(board["title"])}</a></td>'
                f'<td>{before["connected"]}/{before["requested"]} → {after["connected"]}/{after["requested"]}</td>'
                f'<td>{before["traces"]} → {after["traces"]}</td><td>{before["vias"]} → {after["vias"]}</td>'
                f'<td>{before["physicalFindings"]} → {after["physicalFindings"]}</td><td>{"Clean" if after["passed"] else "Incomplete"}</td></tr>')
        cases = []
        for mode in MODES:
            before, after = [board["modes"][mode][side] for side in SIDES]
            stats = ''.join(f'<div><strong>{side.title()}</strong>: {result["connected"]}/{result["requested"]} complete nets; '
                f'{result["traces"]} traces; {result["vias"]} vias; {result["physicalFindings"]} physical findings. '
                f'<b>{html.escape(result["status"])}</b><p>{html.escape("; ".join(result["errors"]))}</p></div>'
                for side, result in [("before", before), ("after", after)])
            cases.append(f'<div class="mode-content mode-{mode}" data-mode="{mode}"><div class="stats">{stats}</div>'
                + pair(before["svg"], after["svg"], mode) + '</div>')
        sections.append(f'<section id="board-{board["id"]}"><h2>{html.escape(board["title"])}</h2>'
            f'<p>{board["parts"]} parts · {board["pads"]} pads · {board["nets"]} source nets. '
            f'<a href="full-board-models/{board["id"]}/board.tsx">Full TSX</a> · '
            f'<a href="full-board-models/{board["id"]}/source.json">Native geometry and net memberships</a></p>'
            + ''.join(cases) + '</section>')
    evidence_links = " · ".join(f'<a href="{filename}">{label}</a>' for filename, label in [
        ("provenance.json", "Revisions and runs"), ("ci.json", "Source validation"),
        ("source-equivalence.json", "Measured/final source equivalence")]
        if (ROOT / filename).exists())
    baseline = provenance.get("baselineRouter", "bfc6509a20959b11ebdea7e38d7fb5fe0fef2097")
    candidate = provenance.get("candidateRouter", "bcc2094a1d0911594a1aa08c1f0ee7a517ac3723")
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Six full-board reroutes · core 2408 / router 1123</title>
<style>body{{margin:auto;max-width:1500px;padding:28px;font:16px/1.55 system-ui;color:#172033;background:#f4f6f9}}h1,h2,h3{{line-height:1.2}}section,.panel{{background:white;border:1px solid #d8dee9;border-radius:12px;padding:24px;margin:24px 0}}a{{color:#1756b4}}.pair,.stats{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}figure{{margin:0}}figcaption{{font-weight:600;padding:12px 0}}img{{width:100%;height:auto;border:1px solid #d9dfe8;background:white}}table{{width:100%;border-collapse:collapse;font-size:15px}}td,th{{text-align:left;padding:12px;border-bottom:1px solid #dce2ec}}th{{background:#edf2f8}}code,pre{{background:#edf1f7}}pre{{padding:16px;overflow:auto}}select{{padding:9px;font-size:16px}}.mode-fanout{{display:none}}.stats p,.muted{{font-size:14px;color:#465469}}.notice{{border-left:4px solid #c3821b;padding:12px 18px;background:#fff7e9}}@media(max-width:800px){{body{{padding:12px}}.pair,.stats{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style>
<h1>Six full-board reroutes</h1><p>Frozen published stack: tscircuit 0.0.3230 · core 0.0.2408 · autorouter 0.0.1123 · fanout 0.0.84 · bus lanes 0.0.61. After adds the existing cramped escape search optimization.</p>
<p><a href="circuits-and-pcb-results.zip">All circuits, native SVGs and evidence ZIP</a> · <a href="analysis.json">Measured analysis</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3919">Repro #3919</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3920">Fix #3920</a>{" · " + evidence_links if evidence_links else ""}</p>
<div class="panel"><h2>Measured improvement: preparation time</h2><p>ButterStick's isolated preparation stage falls from <b>90.256 s to 18.047 s: 80.0% less time</b>, using the median of three serialized runs per revision on the same Blacksmith worker. Every run returns the same complete graph hash. The existing search now skips repeated capacity-node expansions that cannot improve a candidate; it still revisits a node when a cheaper path reaches it.</p>
<table><tr><th>Measurement</th><th>Before</th><th>After</th><th>Time change</th><th>Scope</th></tr>{timing}</table><p><a href="paired-stage.json">All six isolated measurements and graph hashes</a> · <a href="orangecrab-matched-before.json">Matched OrangeCrab before</a> · <a href="orangecrab-matched-after.json">Matched OrangeCrab after</a></p><p class="muted">The separate OrangeCrab matched-input check verifies identical emitted copper. It ran on different workers, taking 509.0 s before and 472.6 s after; those times are not a paired performance measurement.</p>
<p>All six original DDR controls retain all <b>310/310 connected nets</b> with identical traces, via counts and wire lengths, and zero physical findings. These are the smaller original DDR benchmark circuits. Dataset 18 retains <b>16/16 clean samples</b>, identical native SVGs and identical via counts. Full-board completion remains <b>0/6 clean boards in both modes, before and after</b>.</p></div>
<div class="panel"><h2>Native before / after</h2><p>The focused snapshot is an actual 4 × 3 mm cut of ButterStick's plane-escape preparation graph. Its 106 ordered candidates and complete parent chains are preserved while adjacency entries examined fall from 19,002 to 1,178. The graph represents search preparation; the green lines are candidate paths.</p>
{pair("snapshot-comparison/butterstick-cramped-graph-before.svg", "snapshot-comparison/butterstick-cramped-graph-after.svg", "native preparation graph · matched viewport")}
<h3>Full routed OrangeCrab DDR control</h3><p>The real routed control stays identical: 50/50 connected nets, 109 vias and zero physical findings.</p>
{pair("snapshot-comparison/orangecrab-ddr-before.svg", "snapshot-comparison/orangecrab-ddr-after.svg", "native routed DDR circuit")}</div>
<div class="panel"><h2>Whole-board results under the routing budget</h2><p>Original routed copper is removed from every input: 49,583 tracks, 4,706 vias and 685 zones. Authored pour intent is rebuilt fresh. Component counts, pad positions and full net memberships are audited. Runs use 8-vCPU ARM Blacksmith workers, two routing processes per board, a 600-second routing budget, a 660-second process limit and an independent physical audit.</p>
<label for="mode">Routing mode: </label><select id="mode"><option value="phased">Plane escapes → DDR byte buses → remaining signals</option><option value="fanout">Fanout → DDR byte buses → remaining signals</option></select>
<table><tr><th>Full circuit</th><th>Complete nets before → after</th><th>Traces</th><th>Vias</th><th>Physical findings</th><th>After</th></tr>{''.join(table_rows)}</table>
<p class="notice">OrangeCrab publishes more partial copper within the budget: 0 → 430 traces and 0 → 271 vias, exposing 683 physical findings. A separate run gives both revisions enough time on the same phase input; both emit the exact same 430-trace copper hash. The budgeted output advances further, but the board remains incomplete and fails physical checks. This is not a measured routing-quality improvement.</p>
<p>A full board passes only when rendering completes, the process succeeds without a timeout, every routable net is physically connected, and physical findings are zero. Declared pour intent and fanout stubs alone do not complete a net. Incomplete and failed native output is included below.</p></div>
{''.join(sections)}
<section><h2>Dataset 18 regression guard</h2><p>All 16 samples pass DRC and retain the same native PCB SVG hashes and via counts. Average vias remain 212.25. End-to-end timing is reported separately from the isolated preparation-stage measurement; no global dataset 18 speed improvement is claimed. {reverse_note}</p>
<table><tr><th>Execution order / metric</th><th>Before</th><th>After</th><th>Time change</th><th>Routing comparison</th></tr>{dataset_rows}</table>
<p><a href="paired-dataset18.json">First paired report and SVG hashes</a>{' · <a href="reverse-paired-dataset18.json">Reverse-order pair</a>' if reverse else ''}{' · <a href="interleaved-dataset18.json">Adjacent sample pairs</a>' if adjacent else ''} · <a href="ddr-controls.json">All six DDR controls</a></p></section>
<section><h2>Remaining blockers</h2><p>The optimization preserves the graph; it does not resolve dense fanout escape failures, ButterStick's port-point iteration limit, H616's bus surface-approach geometry/matching failure, or the long joint DRC and cleanup work on larger full boards. All six full circuits remain incomplete. More published partial copper does not establish a clean board.</p></section>
<section><h2>Reproduce</h2><p>Use Bun 1.4.3 on Blacksmith. Checkout core at <code>f8f2ed3273cea45e70e78ddc7470ba9fc47a1e73</code>. Checkout the router at <code>{html.escape(baseline)}</code> for before or <code>{html.escape(candidate)}</code> for after, then run:</p><pre>cd full-board-models
bash reproduce.sh /absolute/router /absolute/core /absolute/results</pre><p>The exported models include all six full TSX circuits, original extracted geometry, licenses, the exact dependency lockfile and the harness. Native SVGs and every assessment remain available alongside the measured analysis.</p></section>
<script>document.getElementById('mode').addEventListener('change',event=>{{for(const element of document.querySelectorAll('.mode-content'))element.style.display=element.dataset.mode===event.target.value?(element.tagName==='TR'?'table-row':'block'):'none'}})</script></html>'''
    (ROOT / "index.html").write_text(page)
    print(json.dumps({"totals": totals, "preparationReductionPercent": stage["reductionPercent"],
        "dataset18": dataset, "nativeSvgCount": len(list(ROOT.glob("*.svg")))}, indent=2))


if __name__ == "__main__":
    main()
