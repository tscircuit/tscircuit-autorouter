import hashlib
import html
import json
import re
import shutil
import zipfile
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).parent
MODELS = ROOT / "full-board-models"
BOARDS = json.loads((MODELS / "manifest.json").read_text())
BEFORE = ROOT / "raw-results/before"
AFTER = ROOT / "raw-results/after"


def read(path):
    return json.loads(path.read_text())


def write(name, payload):
    (ROOT / name).write_text(json.dumps(payload, indent=2) + "\n")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(folder):
    assessment = read(folder / "assessment.json")
    progress = read(folder / "progress.json")
    process = read(folder / "process.json")
    diagnostics = read(folder / "diagnostics.json")
    clean = not assessment["geometryErrors"] and not assessment["membershipErrors"]
    passed = (progress["status"] == "completed" and not process["timedOut"]
              and assessment["connectedNets"] == assessment["routableNets"]
              and clean and not any(assessment["findings"].values()))
    assert clean
    assert progress["initialCopperElements"] == 0
    return {"status": progress["status"], "passed": passed,
            "components": assessment["components"], "pads": assessment["pads"],
            "nets": assessment["nets"], "routableNets": assessment["routableNets"],
            "connectedNets": assessment["connectedNets"], "traces": assessment["pcbTraces"],
            "vias": assessment["vias"], "pours": assessment["copperPours"],
            "findings": assessment["findings"], "geometryErrors": assessment["geometryErrors"],
            "membershipErrors": assessment["membershipErrors"], "stage": progress.get("stage"),
            "errors": progress["errors"], "phases": progress["phases"],
            "elapsedMs": progress["elapsedMs"], "process": process,
            "initialCopperElements": progress["initialCopperElements"],
            "runtime": progress["runtime"], "planeIntent": progress["planeIntent"],
            "diagnostics": diagnostics}


def figures(before, after, caption=""):
    return (f'<div class="pair"><figure><figcaption>Before {caption}</figcaption>'
            f'<a href="{before}"><img loading="lazy" src="{before}" alt="Before {caption}"></a></figure>'
            f'<figure><figcaption>After {caption}</figcaption>'
            f'<a href="{after}"><img loading="lazy" src="{after}" alt="After {caption}"></a></figure></div>')


def main():
    provenance = read(ROOT / "provenance.json")
    dataset = read(ROOT / "paired-dataset18.json")
    orange = read(ROOT / "orange-input-equivalence.json")
    ci = read(ROOT / "ci.json")
    rows = []
    controls = []
    for board in BOARDS:
        ident = board["id"]
        row = {**board, "ddr": {}, "full": {"phased": {}, "fanout": {}}}
        for variant, parent in [("before", BEFORE), ("after", AFTER)]:
            root = parent / ident
            ddr = read(root / "ddr" / "results.json")["cases"][0]
            row["ddr"][variant] = {k: ddr[k] for k in ["status", "wallMs", "assessment"]}
            for mode in ["phased", "fanout"]:
                folder = root / "full" / f"{ident}-{mode}"
                result = summarize(folder)
                filename = f"{ident}-{mode}-{variant}.pcb.svg"
                shutil.copy2(folder / "pcb.svg", ROOT / filename)
                result.update(svg=filename, svgSha256=sha(ROOT / filename))
                row["full"][mode][variant] = result
            target = ROOT / "raw-results" / variant / ident
            assert target.resolve() == root.resolve()
        metrics = ["requestedNets", "connectedNets", "unconnectedNets", "pcbTraces", "vias", "wireLengthMm", "findings", "geometryErrors"]
        a, b = row["ddr"]["before"]["assessment"], row["ddr"]["after"]["assessment"]
        controls.append({"board": ident, "metricsIdentical": all(a[k] == b[k] for k in metrics),
                         "before": {k: a[k] for k in metrics}, "after": {k: b[k] for k in metrics}})
        rows.append(row)

    totals = {v: {"ddrPassed": sum(r["ddr"][v]["status"] == "passed" for r in rows),
                  "ddrNets": sum(r["ddr"][v]["assessment"]["connectedNets"] for r in rows),
                  "fullPhasedPassed": sum(r["full"]["phased"][v]["passed"] for r in rows),
                  "fullFanoutPassed": sum(r["full"]["fanout"][v]["passed"] for r in rows),
                  "fullPhasedConnectedNets": sum(r["full"]["phased"][v]["connectedNets"] for r in rows),
                  "fullFanoutConnectedNets": sum(r["full"]["fanout"][v]["connectedNets"] for r in rows)} for v in ["before", "after"]}
    pairs = {v: summarize((ROOT / "raw-results/controlled-orange") / f"pair-{v}" / "full" / "orangecrab-phased") for v in ["before", "after"]}
    for variant, result in pairs.items():
        source = (ROOT / "raw-results/controlled-orange") / f"pair-{variant}" / "full" / "orangecrab-phased" / "pcb.svg"
        result["svg"] = f"orangecrab-controlled-{variant}.pcb.svg"
        shutil.copy2(source, ROOT / result["svg"])
    analysis = {"versions": provenance["versions"], "provenance": provenance, "boards": rows,
                "totals": totals, "ddrEquivalence": controls, "dataset18": dataset,
                "controlledOrange": pairs, "controlledOrangeInput": orange,
                "stitchPhase": {"connections": 559, "beforeStitched": 537, "afterStitched": 559,
                                "improvementPercent": (559 / 537 - 1) * 100, "beforeDrcRepair": True},
                "ci": ci, "viaReview": read(ROOT / "via-review/summary.json"), "snapshotRevision": read(ROOT / "snapshot-revision.json")}
    write("analysis.json", analysis)
    write("ddr-control-equivalence.json", controls)
    write("full-case-comparison.json", [{"board": r["id"], "full": r["full"]} for r in rows])
    write("orange-controlled-comparison.json", {"runs": pairs, "input": orange})

    summary = ""
    cards = ""
    for row in rows:
        title, ident = html.escape(row["title"]), row["id"]
        a, b = row["full"]["phased"]["before"], row["full"]["phased"]["after"]
        blocker = (b["errors"] or [b["status"]])[0]
        summary += (f'<tr><td>{title}</td><td>{row["ddr"]["after"]["assessment"]["connectedNets"]}</td>'
                    f'<td>{a["connectedNets"]} → {b["connectedNets"]}/{b["routableNets"]}</td>'
                    f'<td>{a["traces"]} → {b["traces"]}</td><td>{html.escape(blocker)}</td></tr>')
        cards += (f'<section id="{ident}"><h2>{title}</h2><p>{row["parts"]} components · {row["pads"]} pads · {row["nets"]} nets. '
                  f'<a href="full-board-models/{ident}/board.tsx">Full TSX</a> · '
                  f'<a href="full-board-models/{ident}/source.json">Original placements, pads and nets</a>.</p>')
        for mode in ["phased", "fanout"]:
            cards += f'<h3>{mode.capitalize()}</h3><div class="pair">'
            for variant in ["before", "after"]:
                r = row["full"][mode][variant]
                cards += (f'<figure><figcaption>{variant.capitalize()}: {r["connectedNets"]}/{r["routableNets"]} nets; '
                          f'{r["traces"]} traces; {r["vias"]} vias</figcaption>'
                          f'<a href="{r["svg"]}"><img loading="lazy" src="{r["svg"]}" alt="{title} {mode} {variant}"></a>'
                          f'<p>{html.escape((r["errors"] or [r["status"]])[0])}</p>'
                          f'<details><summary>Physical checks and pipeline stages</summary><pre>{html.escape(json.dumps(r, indent=2))}</pre></details></figure>')
            cards += '</div>'
        cards += '</section>'
    timings = ""
    for key, label in [("p50TimeMs", "P50"), ("p95TimeMs", "P95")]:
        a, b = dataset["beforeSummary"][0][key], dataset["afterSummary"][0][key]
        timings += f'<tr><td>{label}</td><td>{a/1000:.2f}s</td><td>{b/1000:.2f}s</td><td>{(b/a-1)*100:+.2f}%</td></tr>'
    a, b = dataset["beforeMeanMs"], dataset["afterMeanMs"]
    timings += f'<tr><td>Mean</td><td>{a/1000:.2f}s</td><td>{b/1000:.2f}s</td><td>{(b/a-1)*100:+.2f}%</td></tr>'
    unchanged = sum(r["beforeSvgSha256"] == r["afterSvgSha256"] for r in dataset["rows"])
    datasetrows = ''.join(f'<tr><td>{r["sample"]}</td><td>{r["beforeMs"]/1000:.2f}s</td><td>{r["afterMs"]/1000:.2f}s</td><td>{r["beforeVias"]} → {r["afterVias"]}</td><td>{"Identical" if r["beforeSvgSha256"] == r["afterSvgSha256"] else "Changed"} · <a href="dataset18-native/sample{r["sample"]:02d}-before.svg">before</a> / <a href="dataset18-native/sample{r["sample"]:02d}-after.svg">after</a></td></tr>' for r in dataset["rows"])
    pa, pb = pairs["before"], pairs["after"]
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Six full DDR boards — latest release and stitching fix</title><style>
body{{font:16px/1.5 system-ui;max-width:1520px;margin:auto;padding:24px;background:#f5f7fa;color:#17273b}}
section{{background:white;padding:24px;margin:28px 0;border:1px solid #d7dfe8;border-radius:8px}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}figure{{margin:0;min-width:0}}figcaption{{font-weight:650;margin:12px 0}}img{{width:100%;height:auto}}a{{color:#1755a0}}th,td{{padding:10px;text-align:left;border-bottom:1px solid #d7dfe8}}table{{border-collapse:collapse;width:100%}}pre{{white-space:pre-wrap;overflow:auto;font-size:12px}}.notice{{background:#fff3d5;border-left:5px solid #b87910;padding:18px}}@media(max-width:850px){{.pair{{grid-template-columns:1fr}}table{{font-size:12px}}}}
</style><h1>Six full DDR boards: latest release and stitching fix</h1>
<p>tscircuit 0.0.3216 · core 0.0.2402 · autorouter 0.0.1117 · fanout 0.0.84 (published core pin) · bus lanes 0.0.61. Exact revisions: <a href="provenance.json">provenance</a>.</p>
<p class="notice"><b>iCE/Pi captured stitching phase: 537 → 559 connections (+4.1%).</b> The full phase now solves instead of failing on the CPUX terminal layer. The full iCE/Pi reroute reaches 7 → 11/230 connected nets (+57.1%) and publishes 559 plane traces. This remains partial output with physical findings. Clean complete full boards remain {totals['before']['fullPhasedPassed']}/6 → {totals['after']['fullPhasedPassed']}/6 phased and {totals['before']['fullFanoutPassed']}/6 → {totals['after']['fullFanoutPassed']}/6 fanout. Original DDR controls: {totals['after']['ddrNets']}/310 nets. Dataset 18: all 16 solve and pass relaxed DRC.</p>
<p><a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3893">Passing repro #3893</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3894">Stacked fix #3894</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/actions/runs/{provenance['baselineRun']}">Released baseline</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/actions/runs/{provenance['candidateRun']}">Final reroutes and paired benchmarks</a> · <a href="analysis.json">Analysis JSON</a> · <a href="circuits-and-pcb-results.zip">Download models and results</a>.</p>
<table><tr><th>Board</th><th>DDR nets</th><th>Full phased nets, before → after</th><th>Emitted traces</th><th>Remaining blocker</th></tr>{summary}</table>
<section><h2>Selected issue: stitching bypasses a routed via path</h2>
<p>On the iCE/Pi CPUX net, the greedy stitcher prefers an exact-XY jump from the top layer to inner copper over a short planar splice to an existing via. Following the inner fragment then returns to the top layer and leaves the bottom-layer C15.2 terminal unreached. The input contains the correct routed transition. The latest release rerun produces exactly the same stitching constructor input as the repro capture. The fix gives a locally accessible routed transition priority over an unplanned cross-layer hop. Existing via sites and declared transition anchors keep their priority; distant vias and internal via loops cannot divert a valid terminal join. The focused repro uses the original 24 fragments and 32 nearby pads. It now runs native trace simplification after stitching succeeds, asserting both terminal layers and the resulting via positions. Its checked-in SVG changes from 1/2 terminals and 3 via sites to 2/2 terminals and 1 via site. The crop’s remaining relaxed DRC findings are computed and displayed: 12 → 6. The crop stops before joint DRC repair. <a href="snapshot-comparison/index.html">Native snapshot comparison</a> · <a href="snapshot-revision.json">Snapshot revision and production-equivalence proof</a>.</p>
{figures('snapshots/icepi-stitch-before.svg', 'snapshots/icepi-stitch-after.svg', '· CPUX between C15.2 and U1.276')}
<p>The same native snapshot test is updated by the stacked fix. The whole-board view below uses all 8,935 original fragments, 559 phase connections and 1,414 conductive pad obstacles. The whole-board snapshots show <b>stitching before simplification and downstream DRC repair</b>. The focused crop above includes native simplification. Both views retain their remaining physical limitations.</p>
{figures('snapshots/icepi-plane-stitch-before.svg', 'snapshots/icepi-plane-stitch-after.svg', '· whole iCE/Pi plane stitching phase')}
<h3>Actual emitted CPUX route after the complete plane pipeline</h3><p>The raw stitching output contains 3 → 6 via positions before simplification. The revised focused native snapshot above includes simplification and now shows 3 → 1 via positions. The full-board artifact confirms that simplification removes the extra positions: the emitted CPUX trace has one via position, represented by two consecutive layer-span records at the same XY. Both exact terminal coordinates and layers are preserved. The before view below is the failed baseline stitch output; the after view is the actual emitted trace from the completed plane phase. An isolated relaxed-DRC check of this emitted trace against the original 32-pad crop still reports nine contact/clearance findings. This is evidence of restored connectivity and downstream via removal, not a clean finished route.</p>{figures('via-review/cpux-pipeline-before.svg','via-review/cpux-pipeline-after.svg','· CPUX pipeline outcome; stages labelled explicitly')}<p><a href="via-review/summary.json">Via counts and provenance</a> · <a href="via-review/published-review.json">Captured simplification output and actual emitted trace</a> · <a href="via-review/emitted-route-drc.json">Local DRC findings</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44123569958">Read-only artifact inspection</a>.</p><h3>Existing fully routed cutout</h3><p>The existing power/ground cutout changes naturally with the fix. Both versions solve and have zero relaxed DRC errors. QFP16, OrangeCrab start-via and terminal-layer guard snapshots remain unchanged.</p>
{figures('snapshots/icepi-power-ground-cutout-before.svg', 'snapshots/icepi-power-ground-cutout-after.svg', '· routed power/ground cutout; relaxed DRC errors: 0')}
</section>
<section><h2>Original DDR controls and dataset 18</h2><p>All 310 original DDR nets remain connected with zero physical findings. <a href="ddr-control-equivalence.json">Per-board physical metrics and equivalence</a>. Dataset 18 runs before then after on one Blacksmith 8-vCPU ARM worker, Pipeline 9, concurrency 2, 240 seconds per sample. All 16 samples solve and pass relaxed DRC in both versions, with 3,407 vias in each run. Native PCB SVGs are identical for {unchanged}/16 samples. No general routing speedup is claimed from this single pair. H616’s clean DDR control uses 94 → 92 vias (2.1% fewer) and 665.89 → 659.75 mm wire; its 53 nets remain connected. Other original DDR controls retain identical physical metrics.</p>
<table><tr><th>Dataset 18</th><th>Before</th><th>After</th><th>Elapsed time change</th></tr>{timings}</table>
<p><a href="paired-dataset18.json">Per-sample times, vias, DRC and native SVG hashes</a> · <a href="dataset18-before.json">Original before report</a> · <a href="dataset18-after.json">Original after report</a> · <a href="ci.json">CI results</a> · <a href="validation/final-focused-tests.log">Local focused guards</a> · <a href="production-benchmark-equivalence.json">PR source matches the benchmarked production code</a>.</p>
<p>Sample 8 has the only changed native SVG; both versions have the same via count and zero relaxed DRC errors.</p>{figures("dataset18-native/sample08-before.svg","dataset18-native/sample08-after.svg","· dataset 18 sample 8")}<details><summary>All 16 dataset 18 samples</summary><table><tr><th>Sample</th><th>Before</th><th>After</th><th>Vias</th><th>Native SVG</th></tr>{datasetrows}</table></details></section>
<section><h2>Controlled OrangeCrab comparison</h2><p>An additional before/after run uses the same worker, sequential phased routing and identical 600-second budgets. Before: {pa['connectedNets']}/{pa['routableNets']} connected nets, {pa['traces']} emitted traces. After: {pb['connectedNets']}/{pb['routableNets']} nets, {pb['traces']} traces. Repair constructor fields are {'all identical' if orange['identical'] else 'not all identical'}; <a href="orange-controlled-comparison.json">field hashes, complete phase timings and physical checks</a>. The separate board-matrix comparison fell from 430 to 0 emitted partial traces and from 7 to 3 connected nets. Both controlled runs time out in power expansion. Stitched-route constructor fields change; all other constructor fields match. Joint DRC repair takes 377.56s before and 410.11s after in this pair. These measurements do not establish a stable timing effect. Across the six matrix runs, total full phased connected nets stay at 29 → 29. This limitation remains visible alongside the iCE/Pi gain.</p>{figures(pa['svg'],pb['svg'],'· sequential same-worker OrangeCrab run')}</section>
{cards}
<section><h2>Method and remaining work</h2><p>Each TSX contains the complete board, including original component placement, pad geometry and net membership. All original routed tracks, vias and saved poured copper are removed. New pours come from authored plane intent. Every before/after full-board input starts with zero copper elements; geometry and net-membership audits pass for all 24 full-board cases. Physical findings are shown with every native PCB SVG. Phased mode routes plane escapes, DDR byte lanes and remaining signals; fanout mode exercises the current fanout solver first. Complete success requires every routable net connected, routing finished and zero physical findings.</p><p>Budgets are unchanged: 600 seconds routing, 660 seconds process, 180 seconds audit. Phased/fanout runs share a worker at concurrency 2; the separate controlled OrangeCrab pair runs sequentially. Original DDR controls run separately. Frozen workflows and lockfiles are included. Native outputs are the actual emitted copper, including partial results.</p><p>The latest release still exposes independent blockers: ButterStick dense prepared pathing, i.MX6 joint DRC repair, H616 surface approach geometry, fanout escape capacity and large-plane time budgets. The stitching fix was selected because it removes a reproducible terminal-layer failure and recovers the complete captured iCE/Pi phase without relaxing terminal, clearance or DRC checks. The six full boards still require further routing work.</p></section></html>'''
    (ROOT / "index.html").write_text(page)
    for svg in ROOT.rglob("*.svg"):
        ElementTree.parse(svg)
    links = re.findall(r'(?:href|src)="([^"]+)"', page)
    assert all((ROOT / link).exists() or link == "circuits-and-pcb-results.zip" for link in links if not link.startswith(("https:", "#")))
    with zipfile.ZipFile(ROOT / "circuits-and-pcb-results.zip", "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(ROOT.rglob("*")):
            if path.is_file() and path.name != "circuits-and-pcb-results.zip" and path.suffix not in [".b64", ".png", ".pyc"]:
                archive.write(path, path.relative_to(ROOT))
    print(json.dumps({"totals": totals, "identicalDdrMetrics": all(r['metricsIdentical'] for r in controls), "dataset18IdenticalSvgs": unchanged}, indent=2))


if __name__ == "__main__":
    main()
