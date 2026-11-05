#!/usr/bin/env python3
"""Summarize explicit-source benchmark arms and predeclared direct contrasts."""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
import statistics

from summarize import clean, ratio, read_reports, score_ms, stage_ms


DATASETS = {"srj18": 16, "srj24": 26}
HD_STAGE = "highDensityRouteSolver"


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def known_hash(report, object_name, field):
    value = (report["result"].get(object_name) or {}).get(field)
    return value if isinstance(value, str) and value.strip() else None


def same_hash(before, after, object_name, field):
    left = known_hash(before, object_name, field)
    right = known_hash(after, object_name, field)
    return bool(left and right and left == right)


def same_hd_input(before, after):
    return same_hash(before, after, "hdInput", "sha256")


def validate_config(config):
    if config.get("schemaVersion") != 1:
        raise ValueError("Expected arm configuration schemaVersion1")
    arms = config.get("arms")
    if not isinstance(arms, list) or not arms:
        raise ValueError("Configuration must contain nonempty arms")
    ids = set()
    for arm in arms:
        if not isinstance(arm, dict) or not isinstance(arm.get("id"), str) or not arm["id"]:
            raise ValueError("Every arm needs a nonempty id")
        if arm["id"] in ids:
            raise ValueError(f"Duplicate arm id: {arm['id']}")
        if not isinstance(arm.get("commit"), str) or not arm["commit"]:
            raise ValueError(f"Arm {arm['id']} needs an exact commit")
        ids.add(arm["id"])
    if config.get("baselineArm") not in ids:
        raise ValueError("baselineArm must name a configured arm")
    contrasts = config.get("contrasts")
    if not isinstance(contrasts, list) or not contrasts:
        raise ValueError("Configuration must contain nonempty contrasts")
    names = set()
    pairs = set()
    for contrast in contrasts:
        before, after = contrast.get("before"), contrast.get("after")
        if before not in ids or after not in ids or before == after:
            raise ValueError(f"Invalid contrast arms: {before!r}, {after!r}")
        name = contrast.get("id", f"{before}--{after}")
        if not isinstance(name, str) or not name or name in names or (before, after) in pairs:
            raise ValueError(f"Duplicate or invalid contrast: {name}")
        names.add(name)
        pairs.add((before, after))
    return {arm["id"]: arm for arm in arms}


def completed_stages(report):
    result = report["result"]
    timing = result.get("stageTiming") or {}
    stages = timing.get("stages") or []
    names = [stage["stageName"] for stage in stages]
    if timing.get("status") == "complete":
        return set(names)
    active = result.get("errorPhaseName")
    if active:
        # A partial timing snapshot includes its active stage. If that stage
        # has not started yet it is absent, and all recorded stages precede it.
        return set(names[:names.index(active)] if active in names else names)
    # Without the active phase, the last partial stage may be censored. Avoid
    # treating it as complete merely because a timing value was recorded.
    completed = set(names[:-1])
    if (result.get("highDensity") or {}).get("solved") is True and HD_STAGE in names:
        completed.add(HD_STAGE)
    return completed


def hd_completed(report):
    hd = report["result"].get("highDensity") or {}
    return finite(stage_ms(report, HD_STAGE)) and (hd.get("solved") is True or HD_STAGE in completed_stages(report))


def diagnostics(report):
    result = report["result"]
    source = result.get("diagnostics") or (result.get("highDensity") or {}).get("diagnostics") or {}
    return {key: value for key, value in source.items() if finite(value)}


def sample_numbers(pairs):
    return [after["sampleNumber"] for _, after in pairs]


def timing_comparison(pairs, field=None, stage=None):
    if stage is not None:
        selected = [(before, after) for before, after in pairs if finite(stage_ms(before, stage)) and finite(stage_ms(after, stage))]
        before_ms = sum(stage_ms(before, stage) for before, _ in selected)
        after_ms = sum(stage_ms(after, stage) for _, after in selected)
    else:
        selected = [(before, after) for before, after in pairs if finite(before["result"].get(field)) and finite(after["result"].get(field))]
        before_ms = sum(before["result"][field] for before, _ in selected)
        after_ms = sum(after["result"][field] for _, after in selected)
    return {"sampleNumbers": sample_numbers(selected), "count": len(selected),
            "beforeSeconds": before_ms / 1000, "afterSeconds": after_ms / 1000,
            "speedup": ratio(before_ms, after_ms)}


def metric_comparison(pairs, field):
    selected = [(before, after) for before, after in pairs if finite(before["result"].get(field)) and finite(after["result"].get(field))]
    before_sum = sum(before["result"][field] for before, _ in selected)
    after_sum = sum(after["result"][field] for _, after in selected)
    return {"sampleNumbers": sample_numbers(selected), "count": len(selected),
            "eligiblePairCount": len(pairs), "beforeSum": before_sum,
            "afterSum": after_sum, "difference": after_sum - before_sum,
            "missingSampleNumbers": [after["sampleNumber"] for before, after in pairs if not (finite(before["result"].get(field)) and finite(after["result"].get(field)))]}


def provenance_values(selected):
    values = collections.defaultdict(set)
    for report in selected:
        for key, value in (report.get("measurementProvenance") or {}).items():
            values[key].add(json.dumps(value, sort_keys=True, separators=(",", ":")))
    return {key: [json.loads(value) for value in sorted(distinct)] for key, distinct in sorted(values.items())}


def counter_comparison(pairs):
    before_totals, after_totals = collections.defaultdict(float), collections.defaultdict(float)
    counters = {}
    for before, after in pairs:
        for key, value in diagnostics(before).items():
            before_totals[key] += value
        for key, value in diagnostics(after).items():
            after_totals[key] += value
    for key in sorted(set(before_totals) | set(after_totals)):
        selected = [(before, after) for before, after in pairs if key in diagnostics(before) and key in diagnostics(after)]
        before_sum = sum(diagnostics(before)[key] for before, _ in selected)
        after_sum = sum(diagnostics(after)[key] for _, after in selected)
        counters[key] = {
            "matchedSampleNumbers": sample_numbers(selected), "count": len(selected),
            "beforeSum": before_sum, "afterSum": after_sum, "difference": after_sum - before_sum,
            "equalSampleNumbers": [after["sampleNumber"] for before, after in selected if diagnostics(before)[key] == diagnostics(after)[key]],
            "missingBeforeSampleNumbers": [before["sampleNumber"] for before, _ in pairs if key not in diagnostics(before)],
            "missingAfterSampleNumbers": [after["sampleNumber"] for _, after in pairs if key not in diagnostics(after)],
        }
    return {"sampleNumbers": sample_numbers(pairs), "count": len(pairs),
            "beforeTotals": dict(sorted(before_totals.items())),
            "afterTotals": dict(sorted(after_totals.items())), "matchedCounters": counters}


def output_comparison(pairs):
    solved = [(before, after) for before, after in pairs if before["result"].get("didSolve") and after["result"].get("didSolve")]
    available = [(before, after) for before, after in solved if before["result"].get("outputHash") and after["result"].get("outputHash")]
    matched = [after["sampleNumber"] for before, after in available if before["result"]["outputHash"] == after["result"]["outputHash"]]
    return {"pairedSolvedSampleNumbers": sample_numbers(solved), "pairedSolvedCount": len(solved),
            "comparableSampleNumbers": sample_numbers(available), "comparableCount": len(available),
            "matchedSampleNumbers": matched, "matchCount": len(matched),
            "mismatchedSampleNumbers": [after["sampleNumber"] for before, after in available if before["result"]["outputHash"] != after["result"]["outputHash"]],
            "missingHashSampleNumbers": [after["sampleNumber"] for before, after in solved if not before["result"].get("outputHash") or not after["result"].get("outputHash")]}


def stage_cohorts(pairs, names):
    completed_times, clean_times, excluded_stages = {}, {}, {}
    for name in names:
        completed_pairs = [(before, after) for before, after in pairs if name in completed_stages(before) and name in completed_stages(after)]
        clean_stage_pairs = [(before, after) for before, after in completed_pairs if clean(before) and clean(after)]
        completed_times[name] = timing_comparison(completed_pairs, stage=name)
        clean_times[name] = timing_comparison(clean_stage_pairs, stage=name)
        excluded_stages[name] = {
            "beforeCensoredSampleNumbers": [before["sampleNumber"] for before, _ in pairs if stage_ms(before, name) is not None and name not in completed_stages(before)],
            "afterCensoredSampleNumbers": [after["sampleNumber"] for _, after in pairs if stage_ms(after, name) is not None and name not in completed_stages(after)],
        }
    return completed_times, clean_times, excluded_stages


def row_for(dataset, arm, selected):
    elapsed = [report["result"]["elapsedTimeMs"] for report in selected if finite(report["result"].get("elapsedTimeMs"))]
    rss = [(report["sampleNumber"], report["result"]["peakRssBytes"]) for report in selected if finite(report["result"].get("peakRssBytes"))]
    counters = collections.defaultdict(float)
    raw_stages = collections.defaultdict(list)
    failures = collections.Counter()
    for report in selected:
        for key, value in diagnostics(report).items():
            counters[key] += value
        for stage in (report["result"].get("stageTiming") or {}).get("stages", []):
            if finite(stage.get("elapsedTimeMs")):
                raw_stages[stage["stageName"]].append((report["sampleNumber"], stage["elapsedTimeMs"], stage["stageName"] in completed_stages(report)))
        if not clean(report):
            failures[report["result"].get("errorPhaseName") or "unknown"] += 1
    return {
        "dataset": dataset, "arm": arm["id"], "variant": arm["id"], "source": arm,
        "count": len(selected), "expectedCount": DATASETS[dataset],
        "sampleNumbers": [report["sampleNumber"] for report in selected],
        "solved": sum(bool(report["result"].get("didSolve")) for report in selected),
        "clean": sum(clean(report) for report in selected),
        "timeouts": sum(bool(report["result"].get("didTimeout")) for report in selected),
        "otherFailures": sum(not report["result"].get("didSolve") and not report["result"].get("didTimeout") for report in selected),
        "uncleanSolved": sum(bool(report["result"].get("didSolve")) and not clean(report) for report in selected),
        "failurePhaseCounts": dict(sorted(failures.items())),
        "solveSecondsSum": sum(elapsed) / 1000, "solveSecondsCount": len(elapsed),
        "failurePenalizedSecondsSum": sum(score_ms(report) for report in selected) / 1000,
        "rss": {"sampleNumbers": [sample for sample, _ in rss], "count": len(rss),
                "maxBytes": max((value for _, value in rss), default=None),
                "medianBytes": statistics.median(value for _, value in rss) if rss else None,
                "sumBytes": sum(value for _, value in rss)},
        "maxRssBytes": max((value for _, value in rss), default=None),
        "concurrencyValues": sorted({report["measurementProvenance"]["concurrency"] for report in selected if report.get("measurementProvenance", {}).get("concurrency") is not None}),
        "measurementProvenanceValues": provenance_values(selected),
        "sourceProblemHashCoverage": {
            "srjSampleNumbers": [report["sampleNumber"] for report in selected if known_hash(report, "sourceProblem", "srjSha256")],
            "scenarioSampleNumbers": [report["sampleNumber"] for report in selected if known_hash(report, "sourceProblem", "scenarioSha256")],
        },
        "numericDiagnosticTotals": dict(sorted(counters.items())),
        "rawStageTimes": {name: {
            "observedSampleNumbers": [sample for sample, _, _ in values],
            "observedSecondsSum": sum(ms for _, ms, _ in values) / 1000,
            "completedSampleNumbers": [sample for sample, _, complete in values if complete],
            "completedSecondsSum": sum(ms for _, ms, complete in values if complete) / 1000,
            "censoredSampleNumbers": [sample for sample, _, complete in values if not complete],
            "censoredObservedSecondsSum": sum(ms for _, ms, complete in values if not complete) / 1000,
        } for name, values in sorted(raw_stages.items())},
    }


def contrast_for(dataset, contrast, reports, arms):
    before_id, after_id = contrast["before"], contrast["after"]
    pairs = [(reports[(before_id, dataset, sample)], reports[(after_id, dataset, sample)])
             for sample in range(1, DATASETS[dataset] + 1)
             if (before_id, dataset, sample) in reports and (after_id, dataset, sample) in reports]
    common_clean = [(before, after) for before, after in pairs if clean(before) and clean(after)]
    shared_input = [(before, after) for before, after in pairs if same_hd_input(before, after)]
    shared_source_srj = [(before, after) for before, after in pairs if same_hash(before, after, "sourceProblem", "srjSha256")]
    shared_source_scenario = [(before, after) for before, after in pairs if same_hash(before, after, "sourceProblem", "scenarioSha256")]
    hd_pairs = [(before, after) for before, after in shared_input if hd_completed(before) and hd_completed(after)]
    source_hd_pairs = [(before, after) for before, after in shared_source_srj if hd_completed(before) and hd_completed(after)]
    board = timing_comparison(common_clean, field="elapsedTimeMs")
    board.update({"vias": metric_comparison(common_clean, "viaCount"),
                  "wireLengthMm": metric_comparison(common_clean, "wireLengthMm"),
                  "peakRssBytes": metric_comparison(common_clean, "peakRssBytes"),
                  "outputHashMatchSampleNumbers": [after["sampleNumber"] for before, after in common_clean if before["result"].get("outputHash") and before["result"].get("outputHash") == after["result"].get("outputHash")]})
    names = sorted({stage["stageName"] for pair in pairs for report in pair for stage in (report["result"].get("stageTiming") or {}).get("stages", [])})
    completed_times, clean_times, excluded_stages = stage_cohorts(shared_input, names)
    source_completed_times, source_clean_times, source_excluded_stages = stage_cohorts(shared_source_srj, names)
    upstream_phase = [(before, after) for before, after in pairs if not before["result"].get("hdInput") and not after["result"].get("hdInput") and not before["result"].get("didSolve") and not after["result"].get("didSolve") and before["result"].get("errorPhaseName") == after["result"].get("errorPhaseName")]
    upstream_exact = [(before, after) for before, after in upstream_phase if bool(before["result"].get("didTimeout")) == bool(after["result"].get("didTimeout")) and before["result"].get("error") == after["result"].get("error")]
    return {
        "id": contrast.get("id", f"{before_id}--{after_id}"),
        "dataset": dataset, "before": before_id, "after": after_id,
        "beforeSource": arms[before_id], "afterSource": arms[after_id],
        "matchedCount": len(pairs), "matchedSampleNumbers": sample_numbers(pairs),
        "commonClean": board,
        "sameHdInput": {"count": len(shared_input), "sampleNumbers": sample_numbers(shared_input)},
        "sameRawConstructor": {"count": len(shared_input), "sampleNumbers": sample_numbers(shared_input)},
        "sameSourceSrj": {"count": len(shared_source_srj), "sampleNumbers": sample_numbers(shared_source_srj)},
        "sameSourceScenario": {"count": len(shared_source_scenario), "sampleNumbers": sample_numbers(shared_source_scenario)},
        "sameRawConstructorCompletedHd": timing_comparison(hd_pairs, stage=HD_STAGE),
        "sameSourceSrjCompletedHd": timing_comparison(source_hd_pairs, stage=HD_STAGE),
        "sameInputCompletedHd": timing_comparison(hd_pairs, stage=HD_STAGE),
        "outputHashMatches": output_comparison(pairs),
        "diagnosticCounters": {"matched": counter_comparison(pairs),
                               "sameInputCompletedHd": counter_comparison(hd_pairs),
                               "sameRawConstructorCompletedHd": counter_comparison(hd_pairs),
                               "sameSourceSrjCompletedHd": counter_comparison(source_hd_pairs),
                               "commonClean": counter_comparison(common_clean)},
        "rawConstructorCompletedStageTimes": completed_times,
        "sourceSrjCompletedStageTimes": source_completed_times,
        "rawConstructorCommonCleanStageTimes": clean_times,
        "sourceSrjCommonCleanStageTimes": source_clean_times,
        "rawConstructorStageCensoring": excluded_stages,
        "sourceSrjStageCensoring": source_excluded_stages,
        "completedStageTimes": completed_times, "commonCleanStageTimes": clean_times,
        "stageCensoring": excluded_stages,
        "sameUpstreamFailure": {"count": len(upstream_exact), "sampleNumbers": sample_numbers(upstream_exact)},
        "sameUpstreamFailurePhase": {"count": len(upstream_phase), "sampleNumbers": sample_numbers(upstream_phase)},
        "pairs": [{
            "sampleNumber": after["sampleNumber"],
            "sameHdInput": same_hd_input(before, after),
            "sameRawConstructor": same_hd_input(before, after),
            "sameSourceSrj": same_hash(before, after, "sourceProblem", "srjSha256"),
            "sameSourceScenario": same_hash(before, after, "sourceProblem", "scenarioSha256"),
            "beforeSourceProblem": before["result"].get("sourceProblem"),
            "afterSourceProblem": after["result"].get("sourceProblem"),
            "beforeHdInput": before["result"].get("hdInput"),
            "afterHdInput": after["result"].get("hdInput"),
            "beforeHdCompleted": hd_completed(before), "afterHdCompleted": hd_completed(after),
            "beforeHdMs": stage_ms(before, HD_STAGE), "afterHdMs": stage_ms(after, HD_STAGE),
            "beforeCompletedStages": sorted(completed_stages(before)), "afterCompletedStages": sorted(completed_stages(after)),
            **{f"{label}{field[0].upper()}{field[1:]}": report["result"].get(field)
               for label, report in [("before", before), ("after", after)]
               for field in ["didSolve", "relaxedDrcPassed", "didTimeout", "elapsedTimeMs", "errorPhaseName", "error", "peakRssBytes", "viaCount", "wireLengthMm", "outputHash"]},
        } for before, after in pairs],
    }


def build(root, config):
    root = Path(root).resolve()
    arms = validate_config(config)
    reports = read_reports(root, "full")
    expected = {(arm, dataset, sample) for arm in arms for dataset, count in DATASETS.items() for sample in range(1, count + 1)}
    unexpected = set(reports) - expected
    if unexpected:
        raise ValueError(f"Unexpected result keys: {sorted(unexpected)}")
    for (arm, dataset, sample), report in reports.items():
        if report.get("commit") != arms[arm]["commit"]:
            raise ValueError(f"Source commit mismatch for {arm}/{dataset}/{sample}")
        if report.get("mode") != "full" or report.get("timeoutMs") != 360_000 or report.get("effort") != 1:
            raise ValueError(f"Unexpected measurement settings for {arm}/{dataset}/{sample}")
        if not finite(report["result"].get("elapsedTimeMs")) or report["result"]["elapsedTimeMs"] < 0:
            raise ValueError(f"Invalid elapsed time for {arm}/{dataset}/{sample}")
    rows = [row_for(dataset, arm, sorted([report for (arm_id, ds, _), report in reports.items() if arm_id == arm["id"] and ds == dataset], key=lambda report: report["sampleNumber"]))
            for dataset in DATASETS for arm in config["arms"]]
    contrasts = [contrast_for(dataset, contrast, reports, arms) for contrast in config["contrasts"] for dataset in DATASETS]
    canonical_config = json.dumps(config, sort_keys=True, separators=(",", ":")).encode()
    return {
        "schemaVersion": 2, "root": str(root), "mode": "full",
        "configSha256": hashlib.sha256(canonical_config).hexdigest(),
        "configuration": config, "baselineArm": config["baselineArm"],
        "resultCount": len(reports), "rows": rows, "contrasts": contrasts,
        "resultProtocol": {"complete": set(reports) == expected, "expectedCount": len(expected),
                           "observedCount": len(reports), "missing": [list(key) for key in sorted(expected - set(reports))], "unexpected": []},
        "perSampleDiagnostics": [{"arm": arm, "variant": arm, "dataset": dataset, "sampleNumber": sample,
                                  "commit": report["commit"], "source": arms[arm],
                                  "peakRssBytes": report["result"].get("peakRssBytes"),
                                  "sourceProblem": report["result"].get("sourceProblem"),
                                  "hdInput": report["result"].get("hdInput"),
                                  "measurementProvenance": report.get("measurementProvenance"),
                                  "diagnostics": diagnostics(report)}
                                 for (arm, dataset, sample), report in sorted(reports.items())],
        "limitations": [
            "One exploratory measured run per board and arm. Ratios are not confidence intervals; host scheduling, garbage collection and memory pressure can affect wall time.",
            "A failure or an unclean solved board receives the full360-second failure score; its raw elapsed time is retained separately.",
            "Clean means the repository benchmark's relaxed DRC. A clean local proposal or completed HD stage does not establish final-board cleanliness.",
            "sameRawConstructorCompletedHd requires identical raw serialized HD-constructor hashes and both HD stages completed. sameSourceSrjCompletedHd instead requires identical known pre-solve loaded-SRJ hashes and both HD stages completed. Missing hashes and censored HD observations are excluded from their respective completed-HD cohorts.",
            "Matching loaded SRJ establishes common source-board input, not equivalent derived constructor configuration or physical clearance rules. Raw constructor hashes are never canonicalized. Per-pair sourceProblem declarations and rawConstructorContext retain visible field/rule differences, including declared NPTH-hole clearance fields.",
            "Raw-constructor and source-SRJ downstream stage timings have separate explicit completed-stage cohorts, each of which can differ from its completed-HD or common-clean cohort; no ratio is a total-pipeline causal estimate.",
            "Legacy sameInputCompletedHd, sameHdInput, completedStageTimes, commonCleanStageTimes and stageCensoring fields retain strict raw-constructor meaning. Scenario-hash equality is recorded separately and never substituted for SRJ-hash equality.",
            "The common pre-solve source-problem observer changes the measurement protocol from earlier benchmark rounds. Preserve its worker/protocol hashes and do not pool timings with earlier observer versions.",
            "A partial timing includes its active stage. That stage is excluded; when its identity is missing, the last partial stage is conservatively excluded unless explicit HD solved state proves HD completion.",
            "Common-clean board timings compare only boards clean in both arms. Quality changes are reflected separately in clean counts and failure-penalized totals.",
            "Wire length and via comparisons use matched finite values on common-clean boards, with explicit coverage. Missing wire values are never replaced with zero.",
            "Peak RSS is a per-process high-water mark. Its sum is a comparison across boards, not simultaneous machine memory usage.",
            "Per-sample capture serialization and disk overhead are included equally and retained in raw records. Exact source/ref, mode-arm definitions and measurement provenance are retained.",
        ],
    }


def markdown(summary):
    def factor(value):
        return f"{value:.3f}x" if value is not None else "—"

    lines = [f"Measured {summary['resultCount']}/{summary['resultProtocol']['expectedCount']} fresh-process full-pipeline runs.", "",
             "| Dataset | Arm | Runs | Solved | Clean | Timeout | Other fail | Scored seconds |",
             "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for row in summary["rows"]:
        lines.append(f"| {row['dataset']} | {row['arm']} | {row['count']}/{row['expectedCount']} | {row['solved']} | {row['clean']} | {row['timeouts']} | {row['otherFailures']} | {row['failurePenalizedSecondsSum']:.2f} |")
    lines += ["", "| Dataset | Before → after | Common-clean boards | Board speed | Same raw HD pairs | Raw HD speed | Same SRJ HD pairs | SRJ HD speed | Finite wire pairs |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for contrast in summary["contrasts"]:
        board, hd, source_hd = contrast["commonClean"], contrast["sameRawConstructorCompletedHd"], contrast["sameSourceSrjCompletedHd"]
        wire = board["wireLengthMm"]
        lines.append(f"| {contrast['dataset']} | {contrast['before']} → {contrast['after']} | {board['count']} | {factor(board['speedup'])} | {hd['count']} | {factor(hd['speedup'])} | {source_hd['count']} | {factor(source_hd['speedup'])} | {wire['count']}/{wire['eligiblePairCount']} |")
    lines += ["", *[f"- {item}" for item in summary["limitations"]]]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = build(args.root, json.loads(args.config.read_text()))
    target = args.output or args.root / "multiarm-summary.json"
    target.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    target.with_suffix(".md").write_text(markdown(result))
    print(markdown(result))
