#!/usr/bin/env python3
import copy
import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("targeted_parser", ROOT / "parse-targeted-job-log.py")
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)
spec = importlib.util.spec_from_file_location("targeted_source", ROOT / "prepare-targeted-inspection-source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class TargetedParserSourceTest(unittest.TestCase):
    def test_original_targeted_scope_pins_completeness_censoring_and_artifact_identity(self):
        pins = json.loads((ROOT / "test-targeted-source-pins.json").read_text())
        manifest = pins["controllerManifest"]
        config_a, config_b = manifest["baseline"], manifest["experiments"][0]
        hashes = manifest["expectedInputHashesByDataset"]
        def records_for(dataset):
            rows = []
            for sample in parser.TARGETS[dataset]:
                for arm, config in [("A", config_a), ("B", config_b)]:
                    evidence = {"actualSolverName": parser.SOLVER, "actualConstructorName": parser.SOLVER, "solverModule": parser.MODULE, "options": copy.deepcopy(config["options"]), "inputHash": hashes[dataset][str(sample)], "inputMutated": False, "solverFailed": False}
                    rows.append({"qualificationScope": parser.SCOPE, "fullPopulationComplete": False, "targetedSampleNumbers": parser.TARGETS[dataset], "pr": 3198, "dataset": dataset, "round": 1, "sampleNumber": sample, "scenarioName": f"original-{dataset}-{sample}", "expectedInputHash": hashes[dataset][str(sample)], "arm": arm, "sha": pins["baselineSha"] if arm == "A" else pins["candidateSha"], "solverName": parser.SOLVER, "controllerError": None, "official": {"sampleNumber": sample, "didSolve": True, "didTimeout": False, "relaxedDrcPassed": True, "elapsedTimeMs": 100 + sample if arm == "A" else 50 + sample, "viaCount": 2 if arm == "A" else 1, "routingMetrics": {"experimentAudit": evidence}}})
            return rows
        def encode(rows, dataset, summary=True):
            lines = ["2026-10-28T00:00:00Z TARGETED_SCOPE_RESULT_JSON " + json.dumps(row) for row in rows]
            if summary:
                value = {**parser.summarize(rows, dataset), "pr": 3198, "dataset": dataset, "recordCount": len(rows)}
                lines.append("2026-10-28T00:00:01Z TARGETED_SCOPE_SUMMARY_JSON " + json.dumps(value))
            return "\n".join(lines) + "\n"
        def metadata_for(dataset):
            return {"id": 1000 + pins["jobs"][dataset], "name": f"targeted-forest-scope-3198-{dataset}", "size_in_bytes": 1234, "digest": "sha256:" + "5" * 64, "expired": False, "workflow_run": {"id": pins["runId"], "head_sha": pins["controllerSha"], "head_branch": pins["controllerBranch"]}}
        parser.validate_pins(pins)
        with tempfile.TemporaryDirectory() as temporary:
            temporary = pathlib.Path(temporary)
            for dataset, denominator in [("srj18", 1), ("srj24", 4)]:
                records = records_for(dataset)
                log = encode(records, dataset)
                audit, observed = parser.parse_log(log, pins, dataset)
                self.assertEqual(audit["issues"], [])
                self.assertTrue(audit["completeSelectedPopulation"])
                self.assertEqual(audit["targetedSampleCount"], denominator)
                self.assertEqual(audit["recordCount"], denominator * 2)
                self.assertEqual(audit["officialCleanCount"], {"A": denominator, "B": denominator})
                self.assertEqual(audit["mutuallyOfficialCleanSamples"], parser.TARGETS[dataset])
                self.assertFalse(audit["fullPopulationComplete"])
                self.assertFalse(audit["isFullCorpusSweep"])
                self.assertEqual(observed, records)
                metadata = metadata_for(dataset)
                expected = source.prepare(pins, dataset, pins["jobs"][dataset], metadata, log)
                self.assertEqual(expected["targetedSampleNumbers"], parser.TARGETS[dataset])
                self.assertEqual(set(expected["inputHashes"]), {str(n) for n in parser.TARGETS[dataset]})
                self.assertEqual(len(expected["fullInputHashes"]), parser.COUNTS[dataset])
                self.assertEqual(expected["configs"], {"A": config_a, "B": config_b})
                self.assertEqual(expected["controllerManifest"], manifest)
                self.assertEqual(expected["runtimeSourceHashes"], manifest["runtimeSourceHashes"])
                self.assertEqual(expected["runSampleSourceSha256"], manifest["runSampleSourceSha256"])
                self.assertEqual(expected["targetedWrapperSha256"], pins["targetedWrapperSha256"])
                self.assertFalse(expected["fullPopulationComplete"])
                self.assertFalse(expected["isFullCorpusSweep"])
                self.assertEqual(expected["fullDatasetSampleCount"], parser.COUNTS[dataset])
                pinned_artifact = copy.deepcopy(pins)
                pinned_artifact["artifacts"][dataset] = copy.deepcopy(expected["artifact"])
                self.assertEqual(source.prepare(pinned_artifact, dataset, pins["jobs"][dataset], metadata, log), expected)
                pinned_artifact["artifacts"][dataset]["id"] += 1
                with self.assertRaises(ValueError):
                    source.prepare(pinned_artifact, dataset, pins["jobs"][dataset], metadata, log)
                corruptions = [lambda r: r.update(sha="9" * 40), lambda r: r.update(expectedInputHash="0" * 64), lambda r: r.update(qualificationScope="FULL_SWEEP"), lambda r: r.update(fullPopulationComplete=True), lambda r: r.update(targetedSampleNumbers=[1]), lambda r: r.update(sampleNumber=1), lambda r: r.update(round=2), lambda r: r.update(dataset="srj24" if dataset == "srj18" else "srj18"), lambda r: r["official"]["routingMetrics"]["experimentAudit"].update(actualConstructorName="WrongSolver"), lambda r: r["official"]["routingMetrics"]["experimentAudit"]["options"].update(cacheProvider={}), lambda r: r["official"]["routingMetrics"]["experimentAudit"].update(inputHash="0" * 64), lambda r: r["official"].update(sampleNumber=1), lambda r: r["official"].update(viaCount=None)]
                for mutate in corruptions:
                    corrupt = copy.deepcopy(records)
                    mutate(corrupt[-1])
                    # Malformed original identities must fail even without a final summary.
                    corrupt_log = encode(corrupt, dataset, summary=False)
                    bad, _ = parser.parse_log(corrupt_log, pins, dataset)
                    self.assertTrue(bad["issues"])
                    self.assertFalse(bad["completeSelectedPopulation"])
                    with self.assertRaises(ValueError):
                        source.prepare(pins, dataset, pins["jobs"][dataset], metadata, corrupt_log)
                duplicate = log + "TARGETED_SCOPE_RESULT_JSON " + json.dumps(records[0]) + "\n"
                self.assertTrue(parser.parse_log(duplicate, pins, dataset)[0]["issues"])
                with self.assertRaises(ValueError):
                    source.prepare(pins, dataset, pins["jobs"][dataset], metadata, duplicate)
                partial, _ = parser.parse_log(encode(records[:1], dataset, summary=False), pins, dataset)
                self.assertEqual(partial["cleanRegressions"], [])
                self.assertEqual(partial["cleanGains"], [])
                self.assertFalse(partial["completeSelectedPopulation"])
                self.assertIsNone(partial["targetedMutuallyCleanMedianCandidateBaselineTimeRatio"])
                candidate_only, _ = parser.parse_log(encode(records[1:2], dataset, summary=False), pins, dataset)
                self.assertEqual(candidate_only["cleanRegressions"], [])
                self.assertEqual(candidate_only["cleanGains"], [])
                full_log = log.replace("TARGETED_SCOPE_RESULT_JSON", "EXPERIMENT_RESULT_JSON").replace("TARGETED_SCOPE_SUMMARY_JSON", "EXPERIMENT_SUMMARY_JSON")
                ignored, ignored_records = parser.parse_log(full_log, pins, dataset)
                self.assertEqual(ignored_records, [])
                self.assertEqual(ignored["issues"], [])
                self.assertFalse(ignored["completeSelectedPopulation"])
                self.assertEqual(parser.parse_log(full_log + log, pins, dataset)[1], records)
                disguised, _ = parser.parse_log(log.replace("TARGETED_SCOPE_", "NOT_TARGETED_SCOPE_"), pins, dataset)
                self.assertEqual(disguised["recordCount"], 0)
                self.assertTrue(parser.parse_log(log + "TARGETED_SCOPE_RESULT_JSON broken\n", pins, dataset)[0]["issues"])
                summary_wrong = {**parser.summarize(records, dataset), "pr": 3198, "dataset": dataset, "recordCount": len(records), "fullPopulationComplete": True}
                dishonest = encode(records, dataset, summary=False) + "TARGETED_SCOPE_SUMMARY_JSON " + json.dumps(summary_wrong)
                self.assertTrue(parser.parse_log(dishonest, pins, dataset)[0]["issues"])
                for mutate in [lambda m: m.update(name="pinned-experiment-3198-" + dataset), lambda m: m.update(id=True), lambda m: m.update(size_in_bytes=0), lambda m: m.update(digest="sha256:bad"), lambda m: m.update(expired=True), lambda m: m["workflow_run"].update(id=999), lambda m: m["workflow_run"].update(head_sha="8" * 40), lambda m: m["workflow_run"].update(head_branch="codex/deep-experiment-bench")]:
                    bad_metadata = copy.deepcopy(metadata)
                    mutate(bad_metadata)
                    with self.assertRaises(ValueError):
                        source.prepare(pins, dataset, pins["jobs"][dataset], bad_metadata, log)
                with self.assertRaises(ValueError):
                    source.prepare(pins, dataset, 999, metadata, log)
                files = {"pins": pins, "metadata": metadata}
                for name, value in files.items():
                    (temporary / (name + ".json")).write_text(json.dumps(value))
                (temporary / "source.log").write_text(log)
                subprocess.run(["python3", str(ROOT / "parse-targeted-job-log.py"), "--pins", str(temporary / "pins.json"), "--dataset", dataset, "--log", str(temporary / "source.log"), "--output", str(temporary / "audit.json"), "--records", str(temporary / "records.jsonl")], capture_output=True, text=True, check=True)
                subprocess.run(["python3", str(ROOT / "prepare-targeted-inspection-source.py"), "--pins", str(temporary / "pins.json"), "--dataset", dataset, "--job-id", str(pins["jobs"][dataset]), "--artifact-metadata", str(temporary / "metadata.json"), "--log", str(temporary / "source.log"), "--output", str(temporary / "expected.json")], capture_output=True, text=True, check=True)
                self.assertEqual(json.loads((temporary / "expected.json").read_text()), expected)
            failed = records_for("srj18")
            failed[1]["official"].update(didSolve=False, relaxedDrcPassed=False, elapsedTimeMs=1, viaCount=0)
            failed[1]["official"]["routingMetrics"]["experimentAudit"]["solverFailed"] = True
            result, _ = parser.parse_log(encode(failed, "srj18"), pins, "srj18")
            self.assertEqual(result["issues"], [])
            self.assertTrue(result["completeSelectedPopulation"])
            self.assertEqual(result["cleanRegressions"], [4])
            self.assertEqual(result["mutuallyOfficialCleanSamples"], [])
            self.assertEqual(result["targetedMutuallyCleanRoutingTimeTotalsMs"], {"A": 0, "B": 0})
            self.assertIsNone(result["targetedMutuallyCleanMedianCandidateBaselineTimeRatio"])
            failed[1]["official"].update(didTimeout=True, routingMetrics=None, viaCount=None, elapsedTimeMs=360000)
            failed[1]["lastObservedEvidence"] = {"actualSolverName": parser.SOLVER, "inputHash": hashes["srj18"]["4"]}
            result, _ = parser.parse_log(encode(failed, "srj18"), pins, "srj18")
            self.assertEqual(result["issues"], [])
            self.assertIn({"sample": 4, "arm": "B", "status": "progress_only"}, result["constructorAndOptionsChecks"])
            self.assertEqual(result["targetedMutuallyCleanLegacyViaTotals"], {"A": 0, "B": 0})
            for mutate in [lambda p: p.update(fullPopulationComplete=True), lambda p: p.update(controllerBranch="main"), lambda p: p.update(candidateSha="main"), lambda p: p["controllerManifest"]["targetedSampleNumbers"].update(srj18=[1]), lambda p: p["controllerManifest"]["experiments"][0]["options"].update(effort=True), lambda p: p["jobs"].update(srj18=None)]:
                invalid = copy.deepcopy(pins)
                mutate(invalid)
                with self.assertRaises(ValueError):
                    parser.validate_pins(invalid)


if __name__ == "__main__":
    unittest.main()
