#!/usr/bin/env python3
"""Offline exact output identity; elapsed times from different campaigns stay separate."""
import argparse
import copy
import json
import pathlib
import re


def compare(original, refined, followup, manifest, feature, dataset):
    r = followup.r
    ab_manifest = r.validate_manifest(followup.ROOT / "new-experiments-20261029.json")
    old_item, new_item = r.select(ab_manifest, feature), r.select(manifest, feature)
    for parsed, item, order, controller, run_id in [
        (original, old_item, "AB", followup.AB_CONTROLLER, followup.AB_RUN),
        (refined, new_item, "BA", refined.get("controllerSha"), refined.get("runId")),
    ]:
        r.require(parsed.get("experiment") == feature and parsed.get("dataset") == dataset and
                  parsed.get("order") == order and parsed.get("controllerSha") == controller and
                  r.digest(controller) and str(parsed.get("runId")) == str(run_id) and
                  re.fullmatch(r"[1-9][0-9]*", str(run_id)) and
                  re.fullmatch(r"[1-9][0-9]*", str(parsed.get("jobId"))) and
                  parsed.get("baselineSha") == r.MAIN and parsed.get("candidateSha") == item["candidateSha"] and
                  parsed.get("populationComplete") is True, "Parsed source/order/population binding differs")
        expected = [(sample, arm) for sample in range(1, r.COUNTS[dataset] + 1) for arm in order]
        r.require([(row.get("sampleNumber"), row.get("arm")) for row in parsed["records"]] == expected,
                  "Missing/duplicate/reordered source population")
        for row in parsed["records"]:
            pin = r.MAIN if row["arm"] == "A" else item["candidateSha"]
            r.require(row.get("sha") == pin and row.get("expectedInputHash") ==
                      manifest["expectedInputHashesByDataset"][dataset][str(row["sampleNumber"])],
                      "Record source/input identity differs")
    r.require(original.get("manifestSha256") == followup.AB_MANIFEST_HASH and
              original.get("runtimeSha256") == followup.AB_RUNTIME_HASH,
              "Original parsed helper/manifest authority differs")
    r.require(refined.get("refinementController") == manifest["refinementController"] and
              refined.get("runtimeSha256") == r.sha(followup.ROOT / "run-new-experiments-refinements.py"),
              "Refined parsed helper/controller authority differs")
    old = {(row["sampleNumber"], row["arm"]): row for row in original["records"]}
    new = {(row["sampleNumber"], row["arm"]): row for row in refined["records"]}
    rows = []
    for sample in range(1, r.COUNTS[dataset] + 1):
        for arm in "AB":
            before, after = old[sample, arm], new[sample, arm]
            status = {"sampleNumber": sample, "arm": arm,
                      "originalStrict": before.get("strictIntegrityQualified") is True,
                      "refinedStrict": after.get("strictIntegrityQualified") is True,
                      "originalSolved": before["official"].get("didSolve") is True,
                      "refinedSolved": after["official"].get("didSolve") is True,
                      "originalTimeout": before["official"].get("didTimeout") is True,
                      "refinedTimeout": after["official"].get("didTimeout") is True}
            if not all(status[key] for key in ["originalStrict", "refinedStrict", "originalSolved", "refinedSolved"]):
                status.update(comparable=False, identityProved=False,
                              reason="Unqualified/failed/timedout observations remain visible; no identity claim")
                rows.append(status)
                continue
            # Recheck ordinary record integrity while retaining any original
            # parser failure; a terminal-gap issue is never silently upgraded.
            before, after = copy.deepcopy(before), copy.deepcopy(after)
            r.qualify_record(before, ab_manifest, old_item)
            r.qualify_record(after, manifest, new_item)
            r.require(before["strictIntegrityQualified"] and after["strictIntegrityQualified"],
                      "Previously qualified output no longer passes unchanged record checks")
            ba = before["official"]["routingMetrics"]["experimentAudit"]
            aa = after["official"]["routingMetrics"]["experimentAudit"]
            values_before = {key: ba.get(key) for key in ["rawOutputHash", "rawNewTracesHash"]}
            values_after = {key: aa.get(key) for key in values_before}
            for key in ["canonicalCircuitJsonSha256", "physicalCopper", *r.CHECKS]:
                values_before[key], values_after[key] = before["supplemental"].get(key), after["supplemental"].get(key)
            if feature == "joint-layers" and arm == "B":
                path = followup.counter.JOINT_LAYERS_PATH
                old_stats, new_stats = ba.get("evidence", {}).get(path), aa.get("evidence", {}).get(path)
                r.require(isinstance(old_stats, dict) and isinstance(new_stats, dict), "Actual layer work evidence missing")
                values_before["originalAlgorithmCounters"] = old_stats
                values_after["originalAlgorithmCounters"] = {key: new_stats.get(key) for key in old_stats}
            differences = [key for key in values_before if not r.exact(values_before[key], values_after[key])]
            status.update(comparable=True, identityProved=not differences, differingFields=differences)
            rows.append(status)
    candidates = [row for row in rows if row["arm"] == "B"]
    comparable = [row for row in candidates if row["comparable"]]
    return {"experiment": feature, "dataset": dataset,
            "originalRun": followup.AB_RUN, "originalController": followup.AB_CONTROLLER,
            "originalCandidateSha": old_item["candidateSha"], "refinedCandidateSha": new_item["candidateSha"],
            "originalStrictlyQualified": original.get("strictlyQualified") is True,
            "refinedStrictlyQualified": refined.get("strictlyQualified") is True,
            "originalIntegrityIssuesRetained": original.get("integrityIssues", []),
            "refinedIntegrityIssuesRetained": refined.get("integrityIssues", []),
            "records": rows, "comparableCandidateCount": len(comparable),
            "allComparableCandidateOutputsIdentical": bool(comparable) and all(row["identityProved"] for row in comparable),
            "fullPopulationOutputIdentityProved": original.get("strictlyQualified") is True and
                refined.get("strictlyQualified") is True and len(comparable) == r.COUNTS[dataset] and
                all(row["identityProved"] for row in comparable),
            "timingsComparedAcrossCampaigns": False,
            "scope": "Exact output/copper/check/counter identity only; original AB and refined-source BA runtimes are not pooled or presented as same-source order confirmation"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-file", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--original", type=pathlib.Path, required=True)
    parser.add_argument("--refined", type=pathlib.Path, required=True)
    parser.add_argument("--experiment", choices=["delta-drc", "joint-layers"], required=True)
    parser.add_argument("--dataset", choices=["srj18", "srj24"], required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    import importlib.util
    spec = importlib.util.spec_from_file_location("refinement_output_runtime", args.runtime_file)
    followup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(followup)
    _, manifest = followup.validate_manifest(args.manifest)
    result = compare(json.loads(args.original.read_text()), json.loads(args.refined.read_text()),
                     followup, manifest, args.experiment, args.dataset)
    result.update(originalParsedSha256=followup.r.sha(args.original), refinedParsedSha256=followup.r.sha(args.refined),
                  manifestSha256=followup.r.sha(args.manifest))
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: result[key] for key in ["experiment", "dataset", "comparableCandidateCount",
                     "allComparableCandidateOutputsIdentical", "fullPopulationOutputIdentityProved"]}))
    if any(row.get("comparable") and not row.get("identityProved") for row in result["records"]):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
