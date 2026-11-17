import hashlib
import html
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent


def read(path):
    return json.loads(path.read_text())


def summarize(folder):
    assessment = read(folder / "assessment.json")
    progress = read(folder / "progress.json")
    process = read(folder / "process.json")
    diagnostics = read(folder / "diagnostics.json")
    assert not assessment["geometryErrors"] and not assessment["membershipErrors"]
    assert progress["initialCopperElements"] == 0
    physical = sum(n for k, n in assessment["findings"].items() if k != "routing")
    state = diagnostics.get("pipelineLastState") or {}
    return {
        "connected": assessment["connectedNets"], "requested": assessment["routableNets"],
        "traces": assessment["pcbTraces"], "vias": assessment["vias"],
        "physicalFindings": physical, "findings": assessment["findings"],
        "status": progress["status"], "errors": progress["errors"],
        "passed": progress["status"] == "completed" and not process["timedOut"]
        and assessment["connectedNets"] == assessment["routableNets"] and physical == 0,
        "stage": state.get("stage"), "stageTimesMs": state.get("times", {}),
        "phases": progress["phases"], "elapsedMs": progress["elapsedMs"],
        "runtime": progress["runtime"], "process": process,
    }


def pair(before, after, caption):
    return '<div class="pair">' + ''.join(
        f'<figure><figcaption>{variant} · {html.escape(caption)}</figcaption>'
        f'<a href="{svg}"><img loading="lazy" src="{svg}" alt="{variant} {html.escape(caption)}"></a></figure>'
        for variant, svg in [("Before", before), ("After", after)]
    ) + '</div>'


def main():
    boards = read(ROOT / "full-board-models/manifest.json")
    provenance = read(ROOT / "provenance.json")
    dataset = read(ROOT / "paired-dataset18.json")
    rows, controls = [], []
    for board in boards:
        row = {**board, "modes": {}}
        for mode in ["phased", "fanout"]:
            row["modes"][mode] = {}
            for variant in ["before", "after"]:
                parent = ROOT / "raw-results" / variant / board["id"]
                folder = parent / "full" / f'{board["id"]}-{mode}'
                result = summarize(folder)
                filename = f'{board["id"]}-{mode}-{variant}.pcb.svg'
                shutil.copy2(folder / "pcb.svg", ROOT / filename)
                result.update(svg=filename, svgSha256=hashlib.sha256((ROOT / filename).read_bytes()).hexdigest())
                row["modes"][mode][variant] = result
        for variant in ["before", "after"]:
            control = read(ROOT / "raw-results" / variant / board["id"] / "ddr/results.json")["cases"][0]
            controls.append({"board": board["id"], "variant": variant, **control})
        rows.append(row)
    totals = {
        variant: {
            mode: {
                "cleanBoards": sum(row["modes"][mode][variant]["passed"] for row in rows),
                "connectedNets": sum(row["modes"][mode][variant]["connected"] for row in rows),
                "vias": sum(row["modes"][mode][variant]["vias"] for row in rows),
                "physicalFindings": sum(row["modes"][mode][variant]["physicalFindings"] for row in rows),
            } for mode in ["phased", "fanout"]
        } for variant in ["before", "after"]
    }
    analysis = {"boards": rows, "totals": totals, "ddrControls": controls,
                "dataset18": dataset, "provenance": provenance,
                "sepic": read(ROOT / "sepic-comparison.json")}
    (ROOT / "analysis.json").write_text(json.dumps(analysis, indent=2) + "\n")
    table_rows, sections = [], []
    for row in rows:
        before, after = [row["modes"]["phased"][variant] for variant in ["before", "after"]]
        table_rows.append(
            f'<tr><td><a href="#board-{row["id"]}">{html.escape(row["title"])}</a></td>'
            f'<td>{before["connected"]}/{before["requested"]} → {after["connected"]}/{after["requested"]}</td>'
            f'<td>{before["vias"]} → {after["vias"]}</td>'
            f'<td>{before["physicalFindings"]} → {after["physicalFindings"]}</td>'
            f'<td>{"Clean" if after["passed"] else "Incomplete"}</td></tr>'
        )
        cases = []
        for mode in ["phased", "fanout"]:
            before, after = [row["modes"][mode][variant] for variant in ["before", "after"]]
            stats = ''.join(
                f'<div><strong>{variant}</strong>: {result["connected"]}/{result["requested"]} complete nets; '
                f'{result["traces"]} traces; {result["vias"]} vias; {result["physicalFindings"]} physical findings. '
                f'<b>{html.escape(result["status"])}</b><p>{html.escape("; ".join(dict.fromkeys(result["errors"])))}</p></div>'
                for variant, result in [("Before", before), ("After", after)]
            )
            cases.append(f'<div class="case" data-mode="{mode}"><div class="stats">{stats}</div>'
                         + pair(before["svg"], after["svg"], mode) + '</div>')
        sections.append(
            f'<section id="board-{row["id"]}"><h2>{html.escape(row["title"])}</h2>'
            f'<p>{row["parts"]} parts · {row["pads"]} pads · {row["nets"]} source nets. '
            f'<a href="full-board-models/{row["id"]}/board.tsx">Full TSX</a> · '
            f'<a href="full-board-models/{row["id"]}/source.json">Native geometry and net memberships</a></p>'
            + ''.join(cases) + '</section>'
        )
    figures = ''.join(
        f'<h3>{caption}</h3>' + pair(f'snapshot-comparison/{name}-before.svg', f'snapshot-comparison/{name}-after.svg', caption)
        for name, caption in [("sepic-converter-pipeline9-clearance", "SEPIC · full routed circuit"),
                              ("sepic-converter-pipeline9-clearance-bottom-clearance", "SEPIC · fixed 6 × 4 mm native copper view")]
    )
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Six full-board reroutes · core 2405 / router 1120</title>
<style>body{{margin:auto;max-width:1500px;padding:28px;font:16px/1.55 system-ui;color:#172033;background:#f4f6f9}}h1,h2,h3{{line-height:1.2}}section,.panel{{background:white;border:1px solid #d8dee9;border-radius:12px;padding:24px;margin:24px 0}}a{{color:#1756b4}}.pair,.stats{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}figure{{margin:0}}figcaption{{font-weight:600;padding:12px 0}}img{{width:100%;height:auto;border:1px solid #d9dfe8;background:white}}table{{width:100%;border-collapse:collapse;font-size:15px}}td,th{{text-align:left;padding:12px;border-bottom:1px solid #dce2ec}}th{{background:#edf2f8}}code,pre{{background:#edf1f7}}pre{{padding:16px;overflow:auto}}select{{padding:9px;font-size:16px}}.case[data-mode=fanout]{{display:none}}.stats p{{font-size:14px}}@media(max-width:800px){{body{{padding:12px}}.pair,.stats{{grid-template-columns:1fr}}table{{display:block;overflow:auto}}}}</style>
<h1>Six full-board reroutes</h1><p>Frozen stack: tscircuit 0.0.3228 · core 0.0.2405 · autorouter 0.0.1120 · fanout 0.0.84 · bus lanes 0.0.61. After adds the isolated reference-DRC guard.</p>
<p><a href="circuits-and-pcb-results.zip">Download all circuits, native SVGs and evidence</a> · <a href="analysis.json">Measured analysis</a> · <a href="provenance.json">Revisions and runs</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3911">Repro PR #3911</a> · <a href="https://github.com/tscircuit/tscircuit-autorouter/pull/3912">Fix PR #3912</a></p>
<div class="panel"><h2>Measured results</h2><p>{html.escape(provenance["conclusion"])}</p>
<p>Every full-board run starts with original copper removed: 49,583 tracks, 4,706 vias and 685 zones. Authored pour intent is rebuilt fresh. Component and pad counts, pad positions and net memberships are audited. Benchmarks use 8-vCPU ARM Blacksmith workers and two routing processes per board, with a 600-second routing budget, 660-second process limit and independent 180-second audit.</p>
<table><tr><th>Phased routing</th><th>Complete nets before → after</th><th>Vias</th><th>Physical findings</th><th>After</th></tr>{''.join(table_rows)}</table>
<p>A full board passes only when all routable nets are physically connected and physical checks are clear. Declared pour intent and fanout stubs alone do not count as completed nets. Incomplete and failed output remains visible below.</p></div>
<div class="panel"><h2>Accepted fix</h2><p>Exact repair did not receive the cached physical reference checker during copper handoffs. The fix enables its acceptance guards when native preloads or explicit PCB-port connections supply the earlier copper context. Circuit-error priority is preserved, and the joint checker continues validating fixed copper. Plane escape anchors require plane geometry before this reference guard can apply.</p>
<p>The existing SEPIC repro keeps its pinned tscircuit 0.0.3186 runtime constant across both sides. Its VCC/GATE trace-clearance error falls from 1 to 0, with 11.1% fewer vias (18 → 16). The GATE route stays on top, removing two layer transitions. The measured same-layer VCC/GATE gap changes from 0.049 mm to 2.252 mm against the 0.1 mm rule.</p>
<p>{html.escape(provenance["controlsConclusion"])}</p><p><a href="paired-dataset18.json">All 16 paired dataset 18 results and SVG hashes</a> · <a href="sepic-comparison.json">SEPIC geometry measurements</a> · <a href="ci.json">Validation</a></p>{figures}</div>
<div class="panel"><label for="mode">Full-board routing mode: </label><select id="mode"><option value="phased">Plane escapes → DDR byte buses → remaining signals</option><option value="fanout">Fanout solver → DDR byte buses → remaining signals</option></select><p>Click any PCB SVG to inspect it at full resolution.</p></div>
{''.join(sections)}
<section><h2>Analysis and remaining blockers</h2><p>{html.escape(provenance["remainingBlockers"])}</p><details><summary>Rejected candidate</summary><p>The broader external-plane correction was rejected after Glider physical findings rose from 42 to 52. It is excluded from the accepted fix and all after panels on this page. <a href="rejected-candidates.json">Measured rejection record</a></p></details></section>
<section><h2>Reproduce</h2><p>Use Bun 1.4.3. Checkout core at <code>0c16ff6c1382bad4653c9302b852251343a7de9e</code>. Checkout the router at <code>{provenance["baselineRouter"]}</code> for before, or <code>{provenance["candidateRouter"]}</code> for after. Run the included harness on Blacksmith:</p><pre>cd full-board-models
bash reproduce.sh /absolute/router /absolute/core /absolute/results</pre><p>The ZIP includes all six full TSX circuits, extracted native geometry, licenses, exact lockfile, both workflows, every assessment and the unmodified solver-produced PCB SVGs.</p></section>
<script>document.getElementById('mode').addEventListener('change',event=>{{for(const element of document.querySelectorAll('.case'))element.style.display=element.dataset.mode===event.target.value?'block':'none'}})</script></html>'''
    (ROOT / "index.html").write_text(page)
    archive_path = ROOT / "circuits-and-pcb-results.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(ROOT.rglob("*")):
            if path.is_file() and path != archive_path and "__pycache__" not in path.parts:
                archive.write(path, path.relative_to(ROOT))
    print(json.dumps({"totals": totals, "zipBytes": archive_path.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
