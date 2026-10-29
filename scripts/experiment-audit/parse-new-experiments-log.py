#!/usr/bin/env python3
"""Strict immutable-source parser for the new five-experiment characterization."""
import argparse
import importlib.util
import json
import pathlib
import re


def parse_log(text, runtime, manifest, item, dataset, order, run_id, controller_sha):
    records, active, summaries, issues = [], [], [], []
    expected = [(sample, arm) for sample in range(1, runtime.COUNTS[dataset] + 1) for arm in order]
    campaign = manifest["campaign"] + ":" + item["id"]
    for line_number, line in enumerate(text.splitlines(), 1):
        for tag, destination in [("ACTIVE", active), ("RESULT", records), ("SUMMARY", summaries)]:
            marker = "NEW_EXPERIMENT_" + tag + "_JSON "
            if marker not in line:
                continue
            try:
                tail = line.split(marker, 1)[1]
                value, end = json.JSONDecoder().raw_decode(tail)
                if tail[end:].strip() or not isinstance(value, dict):
                    raise ValueError("Trailing/nonobject marker")
                destination.append(value)
            except (ValueError, TypeError) as error:
                issues.append({"kind": "malformed_marker", "line": line_number, "error": str(error)})
            break
    if [(r.get("sampleNumber"), r.get("arm")) for r in active] != expected:
        issues.append({"kind": "active_order_or_population_differs"})
    if [(r.get("sampleNumber"), r.get("arm")) for r in records] != expected:
        issues.append({"kind": "result_order_or_population_differs"})
    for record in records:
        try:
            sample, arm = record["sampleNumber"], record["arm"]
            pin = runtime.MAIN if arm == "A" else item["candidateSha"]
            input_hash = manifest["expectedInputHashesByDataset"][dataset][str(sample)]
            expected_fields = {"campaign": campaign, "experiment": item["id"], "pr": item["pr"], "dataset": dataset, "round": 1, "qualificationMode": "full", "executionOrder": order, "sha": pin, "expectedInputHash": input_hash, "solverName": runtime.SOLVER}
            if arm not in ["A", "B"] or any(not runtime.exact(record.get(k), v) for k, v in expected_fields.items()):
                raise ValueError("Record source/input/config/identity header differs")
            checkpoint = record.get("phaseCheckpointAudit") or {}
            last, status = checkpoint.get("lastDurableCheckpoint") or {}, checkpoint.get("status") or {}
            cp = {"campaign": campaign, "arm": arm, "algorithmSha": pin, "dataset": dataset, "originalSample": sample, "inputSha256": input_hash, "observerSourceSha256": manifest["runtimeSourceHashes"]["phase-checkpoint-observer.ts"], "executionOrder": order, "githubRunId": str(run_id), "controllerSha": controller_sha}
            if any(not runtime.exact(last.get(k), v) for k, v in cp.items()) or status.get("observerSourceSha256") != cp["observerSourceSha256"]:
                raise ValueError("Checkpoint source/controller/run/input identity differs")
            row = record.get("official") or {}
            if row.get("didTimeout") is False and (last.get("event") != "solve_exit" or status.get("solveFinished") is not True):
                raise ValueError("Finished attempt lacks actual terminal checkpoint")
            if type(checkpoint.get("rowCount")) is not int or not 1 <= checkpoint["rowCount"] <= 256 or last.get("sequence") != checkpoint["rowCount"] - 1:
                raise ValueError("Checkpoint sequence/count invalid")
            if row.get("didTimeout") is False and (not runtime.finite(last.get("officialStartOffsetMs")) or last["officialStartOffsetMs"] > row["elapsedTimeMs"] + 2):
                raise ValueError("Checkpoint clock exceeds official elapsed")
            runtime.qualify_record(record, manifest, item)
            if not record["strictIntegrityQualified"]:
                issues.append({"kind": "actual_record_integrity_failed", "sample": sample, "arm": arm, "issues": record["strictIntegrityIssues"]})
        except (KeyError, ValueError, TypeError, AttributeError) as error:
            record["strictIntegrityQualified"] = False
            issues.append({"kind": "malformed_or_unqualified_actual_record", "sample": record.get("sampleNumber"), "arm": record.get("arm"), "error": str(error)})
    summary = runtime.summarize(records, dataset, order)
    if len(summaries) != 1 or not runtime.exact(summaries[0], summary):
        issues.append({"kind": "printed_summary_population_or_values_differ"})
    complete = [(r.get("sampleNumber"), r.get("arm")) for r in records] == expected
    return {"campaign": campaign, "experiment": item["id"], "dataset": dataset, "order": order, "runId": str(run_id), "controllerSha": controller_sha, "baselineSha": runtime.MAIN, "candidateSha": item["candidateSha"], "observedRecordCount": len(records), "expectedRecordCount": len(expected), "populationComplete": complete, "strictlyQualified": complete and not issues, "integrityIssues": issues, "summary": summary, "records": records, "scope": "Every failed/timedout route retained. Characterization qualification never waives a DRC failure or turns a faster failure into optimization. No result-based launch gate."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("log", type=pathlib.Path)
    parser.add_argument("--runtime-file", type=pathlib.Path, required=True)
    parser.add_argument("--manifest", type=pathlib.Path, required=True)
    parser.add_argument("--experiment", required=True)
    parser.add_argument("--dataset", choices=["srj18", "srj24"], required=True)
    parser.add_argument("--order", choices=["AB", "BA"], required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--controller-sha", required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.controller_sha) or not all(re.fullmatch(r"[1-9][0-9]*", value) for value in [args.run_id, args.job_id]):
        raise ValueError("Exact source/run/job identifiers required")
    spec = importlib.util.spec_from_file_location("frozen_new_experiment_runtime", args.runtime_file)
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    manifest = runtime.validate_manifest(args.manifest)
    result = parse_log(args.log.read_text(), runtime, manifest, runtime.select(manifest, args.experiment), args.dataset, args.order, args.run_id, args.controller_sha)
    result.update(jobId=args.job_id, rawLogSha256=runtime.sha(args.log), manifestSha256=runtime.sha(args.manifest), runtimeSha256=runtime.sha(args.runtime_file))
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ["experiment", "dataset", "observedRecordCount", "expectedRecordCount", "populationComplete", "strictlyQualified", "integrityIssues"]}))


if __name__ == "__main__":
    main()
