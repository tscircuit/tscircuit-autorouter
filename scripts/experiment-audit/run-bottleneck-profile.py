#!/usr/bin/env python3
"""Three source-pinned diagnostic CPU profiles, never optimization timings."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
REPOSITORY = ROOT.parent.parent
MANIFEST = ROOT / "bottleneck-profile-manifest.json"


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


old = load_module("reviewed_post588", "run-post588-experiments.py")
patch = load_module("profile_patch", "prepare-bottleneck-profile.py")


def bind(path):
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}


def validate():
    data = json.loads(MANIFEST.read_text())
    assert data["campaign"] == "bottleneck-baseline-profile-20261029"
    assert data["baselineSha"] == old.MAIN and data["baselineTree"] == old.MAIN_TREE
    assert data["sampleTimeoutSeconds"] == 360 and data["sampleIntervalUs"] == 1000
    assert data["diagnosticOnly"] is True and data["optimizationTimingCredit"] is False
    assert [(x["dataset"], x["sample"]) for x in data["cases"]] == [("srj18",14),("srj24",2),("srj24",17)]
    assert data["baselineAuthoritySha256"] == old.sha(ROOT / "post588-experiments-20261029.json")
    authority = old.validate_manifest(ROOT / "post588-experiments-20261029.json")
    for item in data["cases"]:
        assert item["inputHash"] == authority["expectedInputHashesByDataset"][item["dataset"]][str(item["sample"])]
    expected = {".github/workflows/bottleneck-profile.yml", "scripts/experiment-audit/run-bottleneck-profile.py", "scripts/experiment-audit/prepare-bottleneck-profile.py", "scripts/experiment-audit/profile-clock-markers.ts", "scripts/experiment-audit/tests/bottleneck-profile-integrity.py", "scripts/experiment-audit/framed-artifact-log.py", "scripts/experiment-audit/tests/framed-artifact-log-integrity.py"}
    assert set(data["assets"]) == expected
    assert all(old.sha(REPOSITORY / name) == value for name, value in data["assets"].items())
    return data, authority


def profile_facts(directory, raw):
    profiles = sorted(directory.glob("*.cpuprofile"))
    assert len(profiles) == 1, "Actual worker profile missing/multiple; never interpret missing profile as no work"
    profile = json.loads(profiles[0].read_text())
    rows = [json.loads(line) for line in (raw / "phase-checkpoints.jsonl").read_text().splitlines()]
    pids = {r["profilePid"] for r in rows}
    origins = {r["profilePerformanceTimeOriginMs"] for r in rows}
    assert len(pids) == len(origins) == 1
    pid, origin = next(iter(pids)), next(iter(origins))
    assert f".{pid}." in profiles[0].name, "Profile is not the observed solving process"
    assert len(profile["samples"]) == len(profile["timeDeltas"]) > 0
    assert all(type(x) in [int,float] and math.isfinite(x) and x >= 0 for x in profile["timeDeltas"])
    points = [(origin+r["monotonicMs"])*1000 for r in rows]
    assert profile["startTime"] <= min(points) <= max(points) <= profile["endTime"] + 2000
    frames = [node["callFrame"] for node in profile["nodes"]]
    source_frames = [f for f in frames if "/lib/" in f.get("url", "") or "/node_modules/" in f.get("url", "")]
    assert any("AutoroutingPipelineSolver9_PreloadedTraceGraph" in f.get("url", "") for f in source_frames)
    markers = json.loads((directory / "profile-clock-markers.json").read_text())
    assert markers["pid"] == pid and markers["performanceTimeOriginMs"] == origin
    nodes = {node["id"]:node for node in profile["nodes"]}
    parent = {child:node["id"] for node in profile["nodes"] for child in node.get("children",[])}
    hits = {marker["functionName"]:[] for marker in markers["markers"]}
    stamp = profile["startTime"]
    for node, delta in zip(profile["samples"], profile["timeDeltas"]):
        stamp += delta
        while node in nodes:
            name = nodes[node]["callFrame"]["functionName"]
            if name in hits: hits[name].append(stamp / 1000)
            node = parent.get(node)
    bounds = [{"functionName":m["functionName"],"samples":len(hits[m["functionName"]]),
        "offsetLowMs":max(hits[m["functionName"]])-m["endPerformanceMs"],
        "offsetHighMs":min(hits[m["functionName"]])-m["startPerformanceMs"]}
        for m in markers["markers"] if hits[m["functionName"]]]
    clock = {"status":"UNKNOWN","reason":"Missing or inconsistent actual named marker samples","markers":bind(directory/"profile-clock-markers.json"),"markerBounds":bounds}
    if len(bounds) == 2:
        lo, hi = max(x["offsetLowMs"] for x in bounds), min(x["offsetHighMs"] for x in bounds)
        if lo <= hi:
            clock.update(status="ACTUAL_NAMED_MARKER_BRACKET",offsetLowMs=lo,offsetHighMs=hi,uncertaintyWidthMs=hi-lo)
    return {"profile":bind(profiles[0]),"observedRoutingPid":pid,"performanceTimeOriginMs":origin,"actualClockCalibration":clock,
        "profileStartEpochUs":profile["startTime"],"profileEndEpochUs":profile["endTime"],
        "sampleCount":len(profile["samples"]),"sampleIntervalWeightSumUs":sum(profile["timeDeltas"]),
        "sourceFunctionCount":len(source_frames),"sourceFrameInventory":source_frames,
        "stageAlignmentPolicy":"Use actual named-marker offset bracket; omit all sample intervals touching phase-boundary uncertainty. UNKNOWN calibration permits caller-ancestry attribution only. Sampling weights are elapsed estimates, not exact thread CPU time.",
        "profileMissingOrKilledPolicy":"UNKNOWN; no zero-work inference"}


def run(args, manifest, authority):
    checkout, output = args.checkout.resolve(), args.output.resolve()
    assert not output.exists() or not any(output.iterdir()), "Never overwrite a diagnostic attempt"
    output.mkdir(parents=True, exist_ok=True)
    selected = next(x for x in manifest["cases"] if x["dataset"] == args.dataset and x["sample"] == args.sample)
    old.verify_checkouts(authority, {}, {"A":checkout})
    old.verify_dependencies(authority, {"PROFILE":checkout})
    identities = old.pinned.read_identity(checkout,args.dataset)
    identity = next(x for x in identities if x["sampleNumber"] == args.sample)
    assert identity["inputHash"] == selected["inputHash"]
    observer_hash = authority["runtimeSourceHashes"]["phase-checkpoint-observer.ts"]
    config = dict(authority["baseline"], evidencePaths=["opts.effort"], phaseCheckpoint={
        "observerSourceSha256":observer_hash,"campaign":manifest["campaign"],"algorithmSha":old.MAIN,
        "arm":"BASELINE_PROFILE","githubRunId":os.environ.get("GITHUB_RUN_ID"),"controllerSha":os.environ.get("GITHUB_SHA")})
    old.pinned.write_json(output/"config.json",config)
    provenance = {"manifest":manifest,"manifestSha256":old.sha(MANIFEST),"githubRunId":os.environ.get("GITHUB_RUN_ID"),
        "controllerSha":os.environ.get("GITHUB_SHA"),"sourceSha":old.MAIN,"sourceTree":old.MAIN_TREE,
        "inputIdentity":identity,"profileSamplingIntervalUs":1000,"algorithmSourceChanged":False,
        "harness":json.loads((checkout/"experiment-harness-provenance.json").read_text()),
        "diagnosticOnly":True,"optimizationTimingCredit":False}
    old.pinned.write_json(output/"profile-provenance.json",provenance)
    profiles = output/"cpu-profiles";profiles.mkdir()
    os.environ["BOTTLENECK_PROFILE_DIRECTORY"] = str(profiles)
    record = old.pinned.run_sample(checkout,output/"config.json",output/"attempt",args.dataset,args.sample,360)
    record.update({"campaign":manifest["campaign"],"dataset":args.dataset,"sampleNumber":args.sample,"arm":"BASELINE_PROFILE",
        "sha":old.MAIN,"solverName":old.SOLVER,"expectedInputHash":identity["inputHash"],"diagnosticOnly":True,"optimizationTimingCredit":False})
    old.declared.qualify_output(record,output/"attempt",checkout,authority,ROOT,old.pinned.execute_with_deadline)
    raw = output/"attempt/raw"
    audit = old.checkpoint_audit(raw,{"campaign":manifest["campaign"],"arm":"BASELINE_PROFILE","algorithmSha":old.MAIN,
        "dataset":args.dataset,"originalSample":args.sample,"inputSha256":identity["inputHash"],"observerSourceSha256":observer_hash,
        "githubRunId":os.environ.get("GITHUB_RUN_ID"),"controllerSha":os.environ.get("GITHUB_SHA")})
    record["phaseCheckpointAudit"] = audit
    old.pinned.write_json(output/"profile-result.json",record)
    if audit["errors"] or record.get("controllerError"):
        benchmark_log = output/"attempt/benchmark.log"
        print("BOTTLENECK_PROFILE_FAILURE_JSON "+json.dumps({"case":args.dataset+":"+str(args.sample),"observerErrors":audit["errors"],"controllerError":record.get("controllerError"),"benchmarkLogTail":benchmark_log.read_text()[-12000:] if benchmark_log.exists() else None}),flush=True)
    assert audit["errors"] == []
    terminal = ((record.get("official") or {}).get("routingMetrics") or {}).get("experimentAudit") or {}
    assert terminal.get("inputHash") == identity["inputHash"]
    assert record.get("controllerError") is None and record.get("supplementalValidationError") is None and record.get("declaredIntentValidationError") is None
    runtime = record.get("officialReportRuntime") or {}
    assert runtime.get("bunVersion") == "1.4.2" and all(runtime.get(k) == 1 for k in ["threadsPerSample","effectiveThreadsPerSample","cpuBudgetPerSample","requestedConcurrency","workerCount"])
    facts = profile_facts(profiles,raw)
    old.pinned.write_json(output/"profile-source-binding.json",facts)
    print("BOTTLENECK_PROFILE_RESULT_JSON "+json.dumps({"dataset":args.dataset,"sample":args.sample,"sourceSha":old.MAIN,"inputHash":identity["inputHash"],"profile":{k:v for k,v in facts.items() if k != "sourceFrameInventory"},"officialOutcome":record.get("official"),"diagnosticOnly":True,"optimizationTimingCredit":False},separators=(",",":")),flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode",choices=["plan","verify-checkout","verify-dependencies","run"],required=True)
    parser.add_argument("--checkout",type=pathlib.Path)
    parser.add_argument("--dataset",choices=["srj18","srj24"])
    parser.add_argument("--sample",type=int)
    parser.add_argument("--output",type=pathlib.Path)
    args = parser.parse_args()
    manifest, authority = validate()
    if args.mode == "plan":
        matrix = {"include":[{"dataset":x["dataset"],"sample":x["sample"]} for x in manifest["cases"]]}
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"],"a") as stream: stream.write("matrix="+json.dumps(matrix,separators=(",",":"))+"\n")
        print(json.dumps({"matrix":matrix,"diagnosticOnly":True,"optimizationTimingCredit":False}))
    elif args.mode == "verify-checkout": old.verify_checkouts(authority,{}, {"A":args.checkout.resolve()})
    elif args.mode == "verify-dependencies": old.verify_dependencies(authority,{"PROFILE":args.checkout.resolve()})
    else: run(args,manifest,authority)
