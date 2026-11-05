#!/usr/bin/env python3
"""Summarize measured outcomes without letting failed boards appear faster."""
import argparse
import collections
import json
from pathlib import Path
import statistics


def read_reports(root, mode):
    reports = {}
    for path in (root / mode).glob("*/*.json"):
        if path.name.endswith((".output.json", ".task.json")):
            continue
        report = json.loads(path.read_text())
        if "result" not in report:
            continue
        key = (report["variant"], report["dataset"], report["sampleNumber"])
        if key in reports:
            raise ValueError(f"Duplicate result: {key}")
        reports[key] = report
    return reports


def clean(report):
    r = report["result"]
    return bool(r.get("didSolve") and r.get("relaxedDrcPassed"))


def stage_ms(report, name):
    for stage in (report["result"].get("stageTiming") or {}).get("stages", []):
        if stage["stageName"] == name:
            return stage["elapsedTimeMs"]
    return None


def hd_completed(report):
    r = report["result"]
    hd = r.get("highDensity") or {}
    if hd.get("solved"):
        return True
    # Timeout heartbeats from the initial worker omit the solved flag. A
    # recorded later phase still proves that HD had completed.
    return bool(stage_ms(report, "highDensityRouteSolver") is not None and r.get("errorPhaseName") and r["errorPhaseName"] != "highDensityRouteSolver")


def same_hd_input(before, after):
    a = before["result"].get("hdInput")
    b = after["result"].get("hdInput")
    return bool(a and b and a["sha256"] == b["sha256"])


def completed_stage_names(report):
    r = report["result"]
    active = r.get("errorPhaseName")
    stages = (r.get("stageTiming") or {}).get("stages", [])
    return {s["stageName"] for s in stages if s["stageName"] != active}


def ratio(before, after):
    return before / after if after else None


def total(rows, field):
    return sum((r["result"].get(field) or 0) for r in rows)


def score_ms(report):
    if clean(report):
        return report["result"]["elapsedTimeMs"]
    return report["timeoutMs"]


def build(root, mode):
    reports = read_reports(root, mode)
    variants = sorted({key[0] for key in reports})
    datasets = sorted({key[1] for key in reports})
    rows = []
    pair_details = []
    numeric_counters = collections.defaultdict(lambda: collections.defaultdict(float))
    for dataset in datasets:
        for variant in variants:
            selected = [r for (v, d, s), r in reports.items() if v == variant and d == dataset]
            if not selected:
                continue
            selected.sort(key=lambda r: r["sampleNumber"])
            paired = [(reports.get(("control", dataset, r["sampleNumber"])), r) for r in selected]
            paired = [(b, e) for b, e in paired if b is not None]
            paired_clean = [(b, e) for b, e in paired if clean(b) and clean(e)]
            paired_hd = [(b, e) for b, e in paired if hd_completed(b) and hd_completed(e) and same_hd_input(b, e)]
            shared_hd_inputs = [(b, e) for b, e in paired if same_hd_input(b, e)]
            upstream_same_phase = [(b, e) for b, e in paired if not b["result"].get("hdInput") and not e["result"].get("hdInput") and not b["result"].get("didSolve") and not e["result"].get("didSolve") and b["result"].get("errorPhaseName") == e["result"].get("errorPhaseName")]
            upstream_same = [(b, e) for b, e in upstream_same_phase if bool(b["result"].get("didTimeout")) == bool(e["result"].get("didTimeout")) and b["result"].get("error") == e["result"].get("error")]
            common_before = sum(b["result"]["elapsedTimeMs"] for b, e in paired_clean)
            common_after = sum(e["result"]["elapsedTimeMs"] for b, e in paired_clean)
            hd_before = sum(stage_ms(b, "highDensityRouteSolver") or 0 for b, e in paired_hd)
            hd_after = sum(stage_ms(e, "highDensityRouteSolver") or 0 for b, e in paired_hd)
            row = {
                "dataset": dataset,
                "variant": variant,
                "count": len(selected),
                "expectedCount": 16 if dataset == "srj18" else 26,
                "solved": sum(bool(r["result"].get("didSolve")) for r in selected),
                "clean": sum(clean(r) for r in selected),
                "timeouts": sum(bool(r["result"].get("didTimeout")) for r in selected),
                "otherFailures": sum(not r["result"].get("didSolve") and not r["result"].get("didTimeout") for r in selected),
                "solveSecondsSum": total(selected, "elapsedTimeMs") / 1000,
                "failurePenalizedSecondsSum": sum(score_ms(r) for r in selected) / 1000 if mode == "full" else None,
                "maxRssBytes": max((r["result"].get("peakRssBytes") or 0) for r in selected),
                "concurrencyValues": sorted({r.get("measurementProvenance", {}).get("concurrency") for r in selected if r.get("measurementProvenance", {}).get("concurrency") is not None}),
                "pairedCleanCount": len(paired_clean),
                "pairedCleanBeforeSeconds": common_before / 1000,
                "pairedCleanAfterSeconds": common_after / 1000,
                "pairedCleanSpeedup": ratio(common_before, common_after),
                "pairedCleanViaBefore": sum(b["result"].get("viaCount") or 0 for b, e in paired_clean),
                "pairedCleanViaAfter": sum(e["result"].get("viaCount") or 0 for b, e in paired_clean),
                "pairedCleanWireLengthBeforeMm": sum(b["result"].get("wireLengthMm") or 0 for b, e in paired_clean),
                "pairedCleanWireLengthAfterMm": sum(e["result"].get("wireLengthMm") or 0 for b, e in paired_clean),
                "pairedHdCompletedCount": len(paired_hd),
                "pairedHdBeforeSeconds": hd_before / 1000,
                "pairedHdAfterSeconds": hd_after / 1000,
                "pairedHdSpeedup": ratio(hd_before, hd_after),
                "sameHdInputCount": len(shared_hd_inputs),
                "sameUpstreamFailureCount": len(upstream_same),
                "sameUpstreamFailurePhaseCount": len(upstream_same_phase),
                "pairedCompletedStageTimes": {},
                "pairedCleanStageTimes": {},
            }
            all_stage_names = sorted(set().union(*(completed_stage_names(r) for r in selected)))
            for name in all_stage_names:
                # Only same-HD-input pairs are causal evidence about HD and
                # downstream stages. Upstream timing is still retained in the
                # raw per-sample report for resource/noise diagnosis.
                stage_pairs = [(b, e) for b, e in paired if same_hd_input(b, e) and name in completed_stage_names(b) and name in completed_stage_names(e)]
                clean_stage_pairs = [(b, e) for b, e in paired_clean if same_hd_input(b, e) and name in completed_stage_names(b) and name in completed_stage_names(e)]
                for output_key, pairs in [("pairedCompletedStageTimes", stage_pairs), ("pairedCleanStageTimes", clean_stage_pairs)]:
                    before = sum(stage_ms(b, name) or 0 for b, e in pairs)
                    after = sum(stage_ms(e, name) or 0 for b, e in pairs)
                    row[output_key][name] = {"count": len(pairs), "controlSeconds": before / 1000, "experimentSeconds": after / 1000, "speedup": ratio(before, after)}
            if mode == "hd":
                hp = [(b, e) for b, e in paired if b["result"].get("didSolve") and e["result"].get("didSolve")]
                hbefore = sum(b["result"]["elapsedTimeMs"] for b, e in hp)
                hafter = sum(e["result"]["elapsedTimeMs"] for b, e in hp)
                row.update({
                    "pairedHdReplayCompletedCount": len(hp),
                    "pairedHdReplayBeforeSeconds": hbefore / 1000,
                    "pairedHdReplayAfterSeconds": hafter / 1000,
                    "pairedHdReplaySpeedup": ratio(hbefore, hafter),
                    "pairedHdReplayRouteHashMatches": sum(b["result"].get("routeHash") == e["result"].get("routeHash") for b, e in hp),
                })
            rows.append(row)
            for report in selected:
                r = report["result"]
                diagnostics = r.get("diagnostics") or (r.get("highDensity") or {}).get("diagnostics") or {}
                for key, value in diagnostics.items():
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        numeric_counters[f"{dataset}/{variant}"][key] += value
            if variant != "control":
                for b, e in paired:
                    br, er = b["result"], e["result"]
                    bhd = br.get("hdInput") or {}
                    ehd = er.get("hdInput") or {}
                    pair_details.append({
                        "dataset": dataset,
                        "sampleNumber": e["sampleNumber"],
                        "variant": variant,
                        "controlCommit": b["commit"],
                        "experimentCommit": e["commit"],
                        "controlSolved": br.get("didSolve"),
                        "experimentSolved": er.get("didSolve"),
                        "controlClean": br.get("relaxedDrcPassed"),
                        "experimentClean": er.get("relaxedDrcPassed"),
                        "controlTimeout": br.get("didTimeout"),
                        "experimentTimeout": er.get("didTimeout"),
                        "controlSolveMs": br.get("elapsedTimeMs"),
                        "experimentSolveMs": er.get("elapsedTimeMs"),
                        "controlFailurePhase": br.get("errorPhaseName"),
                        "experimentFailurePhase": er.get("errorPhaseName"),
                        "controlError": br.get("error"),
                        "experimentError": er.get("error"),
                        "sameHdInput": bool(bhd and ehd and bhd.get("sha256") == ehd.get("sha256")),
                        "controlHdMs": stage_ms(b, "highDensityRouteSolver"),
                        "experimentHdMs": stage_ms(e, "highDensityRouteSolver"),
                        "controlHdCompleted": hd_completed(b),
                        "experimentHdCompleted": hd_completed(e),
                        "controlViaCount": br.get("viaCount"),
                        "experimentViaCount": er.get("viaCount"),
                        "controlWireLengthMm": br.get("wireLengthMm"),
                        "experimentWireLengthMm": er.get("wireLengthMm"),
                        "outputHashMatches": bool(br.get("outputHash") and br.get("outputHash") == er.get("outputHash")),
                    })
    return {
        "schemaVersion": 1,
        "mode": mode,
        "root": str(root),
        "resultCount": len(reports),
        "rows": rows,
        "pairs": pair_details,
        "numericDiagnosticTotals": dict(numeric_counters),
        "limitations": [
            "One measured run per board and variant; speed ratios are exploratory, not confidence intervals.",
            "Shared CPU quota, GC and memory pressure can affect wall time despite fixed worker count and optional CPU affinity.",
            "Clean means the repository's existing benchmark relaxed DRC, not every manufacturing constraint.",
            "Unsuccessful full-pipeline boards receive their configured timeout as a quality-aware runtime score; raw early failure time is also retained.",
            "HD stage timing comparisons require both HD stages completed AND identical captured HD-input hashes, independently of later-stage success. Downstream phase comparisons also require identical HD inputs. HD replays do not imply final DRC success.",
            "Identical pre-HD inputs are verified by constructor-input hashes. Identical upstream failures are reported separately, not counted as HD algorithm evidence.",
            "Capture serialization/disk overhead is included for all variants and reported separately per sample.",
        ],
    }


def markdown(summary):
    lines = [
        f"Measured {summary['resultCount']} fresh-process {summary['mode']} runs.",
        "",
        "| Dataset | Variant | Runs | Solved | Clean | Timeout | Other fail | Scored s | Paired clean | Board speedup | Paired HD | HD speedup |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    def factor(value):
        return f"{value:.3f}x" if value is not None else "—"
    for r in summary["rows"]:
        score = r["failurePenalizedSecondsSum"]
        lines.append(f"| {r['dataset']} | {r['variant']} | {r['count']}/{r['expectedCount']} | {r['solved']} | {r['clean']} | {r['timeouts']} | {r['otherFailures']} | {score:.1f} | {r['pairedCleanCount']} | {factor(r['pairedCleanSpeedup'])} | {r['pairedHdCompletedCount']} | {factor(r['pairedHdSpeedup'])} |" if score is not None else f"| {r['dataset']} | {r['variant']} | {r['count']}/{r['expectedCount']} | {r['solved']} | n/a | {r['timeouts']} | {r['otherFailures']} | n/a | n/a | n/a | {r.get('pairedHdReplayCompletedCount', 0)} | {factor(r.get('pairedHdReplaySpeedup'))} |")
    lines += ["", *[f"- {item}" for item in summary["limitations"]]]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("root", type=Path)
    p.add_argument("--mode", choices=["full", "hd"], default="full")
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    summary = build(args.root.resolve(), args.mode)
    target = args.output or args.root / f"{args.mode}-summary.json"
    target.write_text(json.dumps(summary, indent=2) + "\n")
    target.with_suffix(".md").write_text(markdown(summary))
    print(markdown(summary))
