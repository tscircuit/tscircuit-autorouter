"""Build the review artifact from immutable replay reports and native SVGs."""

import argparse
from collections import Counter
import gzip
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("--baseline", type=Path, required=True)
parser.add_argument("--results", type=Path, required=True)
parser.add_argument("--pcb", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
BOARDS = {
    "orangecrab": "OrangeCrab rev 0.2.1 ECP5 DDR3",
    "h616": "Allwinner H616 Devboard DDR3",
    "butterstick": "ButterStick r1.0",
    "glider": "Glider mainboard",
    "imx6": "i.MX6 Demo Board",
    "icepi": "iCE/Pi CM0 SBC",
}


def read(path):
    serialized = path.read_bytes()
    return json.loads(gzip.decompress(serialized) if path.suffix == ".gz" else serialized)


def write_json(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(contents, indent=2) + "\n")


def native_rows(path):
    return read(path)[0]


def board_summary(folder, captured):
    progress, diagnostic, assessment, plan = [
        read(folder / name)
        for name in ["progress.json", "diagnostics.json", "assessment.json", "plan.json"]
    ]
    kinds = [phase["autorouter"] for phase in plan["plans"]]
    positions = {kind: [index for index, entry in enumerate(kinds) if entry == kind]
                 for kind in ["fanout", "bus_lanes", "auto_local"]}
    assert max(positions["fanout"]) < min(positions["bus_lanes"])
    assert max(positions["bus_lanes"]) < min(positions["auto_local"])
    assert plan["initialCopperElements"] == progress["initialCopperElements"] == 0
    return {
        "status": progress["status"],
        "partialRequests": diagnostic["fanoutBestSummary"]["routedConnectionCount"],
        "requestedConnections": len(captured["solverParams"]["connections"]),
        "searchExhausted": diagnostic["fanoutLastState"]["failed"],
        "assignmentsReached": diagnostic["fanoutLastState"]["stats"]["assignment"],
        "committedTraces": assessment["pcbTraces"],
        "committedVias": assessment["vias"],
        "busPhasesStarted": sum(phase["solver"] == "BusLanesPipelineSolver" for phase in progress["phases"]),
        "sourceSha256": plan["sourceSha256"],
        "firstFanoutMilliseconds": progress["phases"][0]["elapsedMs"],
        "components": plan["components"],
        "pads": plan["pads"],
        "routableNets": plan["routableNets"],
    }


output = args.output
output.mkdir(parents=True, exist_ok=True)
heads = read(args.results / "final-heads.json")
board_results = []
for board, title in BOARDS.items():
    before_folder = args.baseline / board
    after_folder = args.results / "full-qualified" / board
    captured = read(before_folder / "fanout-1-input.json.gz")
    before = board_summary(before_folder, captured)
    after = board_summary(after_folder, captured)
    hashes = read(after_folder / "circuit-hashes.json")
    worker_svg = read(after_folder / "pcb-svg-hashes.json")
    assert hashes["sameInput"] and hashes["samePhysicalCircuit"]
    assert worker_svg["sameWorkerSvgBytes"]
    assert before["sourceSha256"] == after["sourceSha256"]
    assert before["committedTraces"] == after["committedTraces"] == 0
    assert before["committedVias"] == after["committedVias"] == 0
    assert before["busPhasesStarted"] == after["busPhasesStarted"] == 0
    assert read(after_folder / "core-build.json") == {
        "coreCommit": "75ab017cd6852dbe50516ee1f4ca9d1108c29985", "coreVersion": "0.0.2427",
    }
    assert read(after_folder / "core-package.json")["devDependencies"]["@tscircuit/fanout-solver"].endswith(heads["boundary"])
    board_results.append({"board": board, "title": title, "before": before, "after": after,
                          "hashes": hashes, "workerSvg": worker_svg})
    # The exact physical CircuitJson is unchanged. Reuse its native renderer
    # output rather than drawing uncommitted diagnostic traces onto a PCB.
    for stage in ["before", "after"]:
        destination = output / "pcb" / stage / f"{board}.svg"
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            os.link(args.pcb / f"{board}.svg", destination)

joint = []
for board in ["icepi", "imx6", "glider"]:
    before = (next(row for row in native_rows(args.results / "constrained" / f"{board}.json") if row["variant"] == "s")
              if board != "glider" else native_rows(args.results / "glider-sites-control.json")[0])
    after = (next(row for row in native_rows(args.results / "pruned" / f"{board}.json") if row["variant"] == "afterb")
             if board != "glider" else native_rows(args.results / "pruned" / "glider-afterb.json")[0])
    for row in [before, after]:
        assert row["copperDrc"]["valid"] and row["requestConstraints"]["valid"]
        assert row["failed"] and not row["timedOut"]
    assert before["inputSha256"] == after["inputSha256"]
    first, second = before["bestPartial"]["routed"], after["bestPartial"]["routed"]
    before_names = set(before["bestPartial"]["connectionNames"])
    after_names = set(after["bestPartial"]["connectionNames"])
    original = (next(row for row in native_rows(args.results / "original-controls" / f"{board}.json") if row["variant"] == "original305")
                if board != "glider" else native_rows(args.results / "glider-controls" / "original305.json")[0])
    assert set(original["bestPartial"]["connectionNames"]) == after_names
    assert original["bestPartial"]["vias"] == after["distinctDrills"]
    joint.append({
        "board": board, "requests": before["inputConnections"],
        "before": first, "after": second, "improvementPercent": 100 * (second / first - 1),
        "drillsBefore": before["distinctDrills"], "drillsAfter": after["distinctDrills"],
        "inputSha256": before["inputSha256"], "independentDrcIssuesAfter": 0,
        "originalRequestViolationsAfter": 0, "committed": False,
        "retainedRequests": sorted(before_names & after_names),
        "lostRequests": sorted(before_names - after_names),
        "gainedRequests": sorted(after_names - before_names),
        "matchesOriginal305RequestSetAndDrillCount": True,
    })

boundaries = {stage: {"cases": 0, "accepted": 0, "drills": 0} for stage in ["before", "after"]}
gains, losses = [], []
for path in sorted((args.results / "physical-boundaries").glob("*.json")):
    reports = {report["revision"]: report["rows"] for report in read(path)}
    assert len(reports["before"]) == len(reports["after"])
    for first, second in zip(reports["before"], reports["after"]):
        assert first["connectionName"] == second["connectionName"]
        assert first["inputSha256"] == second["inputSha256"]
        assert first["resolvedTraceWidth"] == second["resolvedTraceWidth"]
        for stage, row in [("before", first), ("after", second)]:
            boundaries[stage]["cases"] += 1
            if row["status"] == "solved":
                assert row["copperDrc"]["valid"] and row["requestConstraints"]["valid"]
                boundaries[stage]["accepted"] += 1
                boundaries[stage]["drills"] += row["distinctDrills"]
        transition = {"board": path.stem, "request": first["connectionName"]}
        if first["status"] != "solved" and second["status"] == "solved": gains.append(transition)
        if first["status"] == "solved" and second["status"] != "solved": losses.append(transition)
assert boundaries == {"before": {"cases": 300, "accepted": 235, "drills": 180}, "after": {"cases": 300, "accepted": 247, "drills": 165}}
assert len(gains) == 13 and len(losses) == 1

frozen = read(args.results / "frozen-qualified.json")
assert len(frozen) == 2 and frozen[0]["svgs"] == frozen[1]["svgs"]
for replay in frozen:
    assert Counter(row["status"] for row in replay["report"]["rows"]) == {"solved": 30, "timeout": 42}
scope = read(args.results / "frozen-scope.json")[0]
assert len(scope) == 72 and all(not row["coordinationEligible"] for row in scope)

before_total = sum(row["before"] for row in joint)
after_total = sum(row["after"] for row in joint)
analysis = {
    "scope": "Fresh fanout → bus lanes → rest, with original dimensions, pads, pours, nets and routing rules. Joint partial requests, isolated requests and full-board completion are separate cohorts.",
    "heads": heads, "nativeJoint": joint,
    "jointSummary": {"before": before_total, "after": after_total,
                     "improvementPercent": 100 * (after_total / before_total - 1),
                     "drillsBefore": sum(row["drillsBefore"] for row in joint),
                     "drillsAfter": sum(row["drillsAfter"] for row in joint)},
    "isolatedBoundaries": {"results": boundaries, "gains": gains, "losses": losses,
                           "widthPolicy": "Each one-request replay explicitly uses the selected original request's resolved width on both revisions. No synthetic exit/layer/via guidance.",
                           "overlapsJointCohort": True},
    "fullBoards": board_results,
    "fullPartialCopperAudit": read(args.results / "final-full-partial-drc.json"),
    "fullBoardsComplete": {"before": 0, "after": 0},
    "frozen": {"cases": 72, "solvedBefore": 30, "solvedAfter": 30, "identicalCompletedSvgs": 30,
               "comparisonSource": "65ef90385520060caa1e851b1156453df04a800e",
               "finalPruningPolicy": "Disabled on all72 inputs because the ordinary mixed-singleton eligibility predicate is false. New readonly preparation markers are not claimed byte-identical."},
    "experiments": [
        {"change": "Remove cached repair", "nativeAfter": [16, 16, 75], "decision": "Rejected; loses2/3/3 valid escapes."},
        {"change": "Remove residual ordinary pass", "nativeAfter": [18, 19, 66], "decision": "Rejected; loses12 valid Glider escapes."},
        {"change": "Order free candidates by inferred heading", "nativeAfterWithBoundaryFix": [18, 19, 77], "decision": "Rejected; fixed cardinal order retains18/19/78 with both defaults."},
        {"change": "Remove blocked-layer pruning", "nativeAfter": [18, 19, 78], "decision": "Rejected; paired small searches take75–82s instead of15–17s, with identical copper."},
        {"change": "Unscoped neighboring plane sites", "decision": "Rejected; frozen solves drop30→28. Restrict new sites to ordinary mixed singletons."},
        {"change": "Reroute blockers repeatedly inside assignments", "decision": "Rejected;180s timeouts and a foreign terminal-pour violation. Use one bounded cached repair instead."},
    ],
    "limitations": [
        "All six full boards still stop at the first incomplete atomic fanout. No committed traces/vias and no DDR bus phase.",
        "The published baseline partials contain invalid copper or request violations. Do not treat raw baseline request counts as valid complete nets.",
        "The boundary heuristic has one known OrangeCrab loss, listed explicitly. Its standalone gains must not be added to the overlapping joint cohort.",
        "ButterStick loses some previously DRC-clean requests as well as removing invalid ones; inspect per-request transitions in the audit.",
        "Timing percentages are single paired Blacksmith replays to search exhaustion, not a claim about P50/P95 or full-board solve time.",
    ],
}
write_json(output / "analysis.json", analysis)

versions = {"tscircuit": "0.0.3245", "coreSource": "0.0.2427", "fanoutBaseline": "0.0.91", "capacityAutorouter": "0.0.1134", "busLanes": "0.0.62", "bun": "1.4.3"}
runs = {"publishedBaseline": 44519377875, "original305Control": 44544003763,
        "initialSubsets": 44533142040, "unscopedFrozenRejection": 44533882335,
        "liveRepairRejection": 44535227074, "ordinaryCandidateExperiments": 44538318306,
        "cachedCandidateExperiments": 44542183395, "permittedLayerExperiment": 44547259196,
        "residualExperiment": 44549003751, "geometryExtraction": 44551557611,
        "constrainedNative": 44555832514, "removePhaseAblations": 44556112835,
        "canonicalHeadingOrder": 44557203119, "originalWidthBoundaryChecks": 44557445173,
        "blockedLayerPruning": 44559963832, "siteOnlyGlider": 44560638936,
        "frozenComparison": 44558884427, "finalFullBoards": 44561556033}
write_json(output / "provenance.json", {
    "date": "2026-11-19", "versions": versions, "heads": heads,
    "coreSourceCommit": "75ab017cd6852dbe50516ee1f4ca9d1108c29985",
    "routerCommit": "a4a8f3a71dd66c2cae01d6a7ade426efad833ff6",
    "workflowRuns": {name: f"https://github.com/tscircuit/tscircuit-autorouter/actions/runs/{run}" for name, run in runs.items()},
    "finalLibraryEquivalentMeasuredSources": {"coordination": "2367832632bb657ecb3f4c9097a0fa6840db9ef6", "boundary": "8df481befb5a6c33c2f172ef31322222d7436732"},
    "originalTsxSources": "https://github.com/tscircuit/tscircuit-autorouter/tree/a3416878451bbe69df04ab4d27a67ac2fa0446f4/rerun2427/sources",
    "originalSourceArchive": "https://github.com/tscircuit/tscircuit-autorouter/blob/a3416878451bbe69df04ab4d27a67ac2fa0446f4/rerun2427/circuits-and-results.zip",
    "checks": {
        "318": {"format": 44555281523, "types": 44555281636, "testShards": 44555281646},
        "305": {"format": 44561557747, "types": 44561557716, "testShards": 44561557620},
        "322": {"format": 44561560760, "types": 44561560590, "testShards": 44561560690},
    },
    "checkOutcome": "All formatting, full typechecks and eight test shards pass on each final PR head.305/322 dependency-install404 failures passed on retry without source changes.",
    "pcbPresentation": "Exact1600x1100 worker SVGs are preserved in reports/full-qualified; each equals its baseline worker export byte-for-byte. PCB views use the shared native1400x950 white rendering of the identical physical CircuitJson.",
})

# One copy of each native board vector, used twice for a self-contained
# before/after contact sheet. Prefix IDs to keep each board's masks isolated.
ns = "{http://www.w3.org/2000/svg}"
ET.register_namespace("", "http://www.w3.org/2000/svg")
sheet = ET.Element(ns + "svg", {"width": "2000", "height": "4930", "viewBox": "0 0 2000 4930"})
definitions = ET.SubElement(sheet, ns + "defs")
ET.SubElement(sheet, ns + "rect", {"width": "2000", "height": "4930", "fill": "white"})


def label(x, y, message, size=18):
    ET.SubElement(sheet, ns + "text", {"x": str(x), "y": str(y), "font-size": str(size),
                                      "font-family": "sans-serif", "fill": "#172033"}).text = message


label(20, 32, "Six original full boards — before / minimal stack", 25)
label(20, 65, "Fanout → bus lanes → rest.0/6 complete;0 committed traces/vias. Partial escapes are not drawn onto these PCBs.")
for index, row in enumerate(board_results):
    board = row["board"]
    native = ET.parse(args.pcb / f"{board}.svg").getroot()
    identifiers = {element.attrib["id"]: board + "-" + element.attrib["id"]
                   for element in native.iter() if "id" in element.attrib}
    for element in native.iter():
        for key, content in list(element.attrib.items()):
            if key == "id": content = identifiers[content]
            else:
                content = re.sub(r"url\(#([^)]+)\)", lambda match: "url(#" + identifiers.get(match.group(1), match.group(1)) + ")", content)
                if content.startswith("#") and content[1:] in identifiers: content = "#" + identifiers[content[1:]]
            element.set(key, content)
    symbol = ET.SubElement(definitions, ns + "symbol", {"id": "board-" + board,
                          "viewBox": f"0 0 {native.attrib['width']} {native.attrib['height']}"})
    symbol.extend(list(native))
    for column, stage in enumerate(["before", "after"]):
        x, y = 20 + column * 1000, 95 + index * 800
        result = row[stage]
        label(x, y + 25, row["title"] + " — " + stage.title(), 19)
        label(x, y + 53, f"Uncommitted first-region partial {result['partialRequests']}/{result['requestedConnections']};0 committed traces/vias", 15)
        ET.SubElement(sheet, ns + "use", {"href": "#board-" + board, "x": str(x), "y": str(y + 65), "width": "960", "height": "715"})
ET.ElementTree(sheet).write(output / "all-boards.svg", encoding="unicode")

page = ['<!doctype html><meta charset="utf-8"><title>Minimal fanout stack</title>',
        '<style>body{font:16px system-ui;color:#172033;max-width:1500px;margin:auto;padding:28px}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #d8dee8;padding:10px;text-align:left}img{max-width:100%;background:white}h2{margin-top:32px}code{overflow-wrap:anywhere}.note{color:#48566b}</style>',
        '<h1>Minimal fanout stack</h1>',
        '<p>Valid joint partial escapes increase 77→115 (+49.4%) across three original native captures; physical drills increase 69→96. All six full boards still stop at their first incomplete fanout. No committed traces/vias and no DDR bus phase.</p>',
        '<p><a href="analysis.json">Exact statistics</a> · <a href="provenance.json">Versions and runs</a> · <a href="all-boards.svg">All full-board PCB SVGs before/after</a></p>',
        '<p>Repros #304→#321, then fixes <a href="https://github.com/tscircuit/fanout-solver/pull/318">#318</a>→<a href="https://github.com/tscircuit/fanout-solver/pull/305">#305</a>→<a href="https://github.com/tscircuit/fanout-solver/pull/322">#322</a>. Each fix is one commit.</p>',
        '<h2>Joint native fanout captures</h2><p>Before is the request-safe site fix; after is the full stack. Every listed attempt passes copper DRC, original widths, explicit physical leads and finite same-net plane landings. These remain uncommitted partials.</p>',
        '<table><tr><th>Capture</th><th>Before</th><th>After</th><th>Improvement</th><th>Physical drills</th></tr>']
for row in joint:
    page.append(f"<tr><td>{html.escape(BOARDS[row['board']])}</td><td>{row['before']}/{row['requests']}</td><td>{row['after']}/{row['requests']}</td><td>+{row['improvementPercent']:.1f}%</td><td>{row['drillsBefore']}→{row['drillsAfter']}</td></tr>")
page.append('</table><p class="note">Blue discs are actual vias. Small colored dots are debug endpoints. The following views crop native SVGs to the same physical region; via, wire and obstacle geometry is unchanged.</p>')
page.append('<p>The new best partial retains 9 of the earlier 10 iCE/Pi requests and gains 9; retains all 12 i.MX6 requests and gains 7; retains 50 of the earlier 55 Glider requests and gains 28. These are changed best-partial memberships, not additional completed boards. The final extraction preserves the original #305’s exact request sets and drill counts on all three captures.</p>')
for board in ["icepi", "imx6"]:
    page.append(f'<h3>{html.escape(BOARDS[board])}</h3><table><tr><th>Before</th><th>After</th></tr><tr><td><img src="figures/{board}-before.svg"></td><td><img src="figures/{board}-after.svg"></td></tr></table>')
page.extend([
    '<h2>Independent boundary requests</h2><p>235/300→247/300 accepted (+5.1%); 180→165 physical drills (−8.3%). Every accepted request passes physical DRC and its original resolved width. These 300 one-request controls overlap the joint cohort and must not be added to it.</p>',
    '<p>There are 13 gains and one OrangeCrab loss: breakout 5’s new rightward sites collide with C4. Explicit directions and ambiguous corner/interior inference retain their existing behavior.</p>',
    '<h2>Experiments retained in the minimal extraction</h2><table><tr><th>Experiment</th><th>Result</th><th>Decision</th></tr>',
    '<tr><td>Remove cached repair</td><td>iCE18→16;i.MX19→16;Glider78→75</td><td>Keep the bounded cached repair.</td></tr>',
    '<tr><td>Remove residual ordinary pass</td><td>Glider78→66</td><td>Keep the single residual pass.</td></tr>',
    '<tr><td>Use inferred free-heading tie order</td><td>Adding the boundary default drops Glider78→77</td><td>Use a stable cardinal order only for truly unconstrained requests; retain78 with either default.</td></tr>',
    '<tr><td>Remove blocked-layer pruning</td><td>Identical copper; small native searches take75–82s instead of15–17s</td><td>Keep the small original pruning fix. The coordinated pool retains every allowed layer.</td></tr></table>',
    '<p class="note">Timing comparisons are single paired Blacksmith replays to search exhaustion, not P50/P95 or full-board solve-time claims. All routing experiments use original physical rules. Earlier DRC-only counts that missed request-width/lead violations are superseded by the independent request audit.</p>',
    '<h2>Full-board results</h2><p>All source geometry, nets and rules match the captured originals. Original traces and vias are removed; original pours remain as geometry and plane targets. Every plan orders fanout before bus lanes before the remaining nets. The first atomic fanout is incomplete on every board, so the full emitted PCBs have no new traces or vias.</p>',
    '<table><tr><th>Board</th><th>Published baseline first-region partial</th><th>After stack</th><th>Committed traces/vias</th><th>Native PCB SVG</th></tr>',
])
for row in board_results:
    first, second = row["before"], row["after"]
    page.append(f'<tr><td>{html.escape(row["title"])}</td><td>{first["partialRequests"]}/{first["requestedConnections"]}</td><td>{second["partialRequests"]}/{second["requestedConnections"]}</td><td>0/0</td><td><a href="pcb/before/{row["board"]}.svg">Before</a> · <a href="pcb/after/{row["board"]}.svg">After</a></td></tr>')
page.extend([
    '</table><p>The published baseline partials include invalid copper or original-request violations; their raw counts are not valid complete-net totals. ButterStick also loses some previously clean requests, so its count reduction is not explained entirely by rejecting invalid vias. See the per-request DRC audit.</p>',
    '<h2>Regression qualification</h2><p>Frozen Fanout31: 30/72 solved before and after, 42 timeouts in each run; all 30 completed SVG hashes match. The final blocked-layer pruning predicate is false for all 72 cases. Literal PreparedBus byte equality is not claimed after the new readonly constraint markers.</p>',
    '<p>The original full #305 control passes all physical/request checks at 18/19/78. The extraction retains those yields, introduces no solver class, and keeps candidate generation, selection and repair in small modules. The incremental route generator yields between candidate and selection work.</p>',
    '<h2>All emitted full-board PCBs</h2><img src="all-boards.svg">',
])
(output / "index.html").write_text("\n".join(page))
print(json.dumps({"joint": analysis["jointSummary"], "boundaries": boundaries, "fullBoardsComplete": 0, "frozenSolved": 30}, indent=2))
