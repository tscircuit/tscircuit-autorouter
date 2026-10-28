import copy
import json
from pathlib import Path
import tempfile
import unittest

import multiarm_summary as summary


class MultiarmSummaryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = {"schemaVersion": 1, "baselineArm": "control",
                       "arms": [{"id": "control", "commit": "base", "role": "baseline"},
                                {"id": "old-clock", "commit": "old", "role": "previous"},
                                {"id": "lazy", "commit": "new", "role": "candidate"}],
                       "contrasts": [{"before": "control", "after": "lazy"},
                                     {"id": "refinement", "before": "old-clock", "after": "lazy"}]}

    def record(self, arm, sample, elapsed=10_000, solved=True, clean=True,
               hd_ms=5_000, phase=None, hd_hash="same", timeout=False,
               via=5, wire=50, timing_status=None, hd_solved=None):
        stages = []
        if hd_ms is not None:
            stages.append({"stageName": summary.HD_STAGE, "elapsedTimeMs": hd_ms})
        if phase == "repair":
            stages.append({"stageName": "repair", "elapsedTimeMs": 7_000})
        result = {"elapsedTimeMs": elapsed, "didSolve": solved,
                  "didTimeout": timeout, "relaxedDrcPassed": clean,
                  "viaCount": via, "wireLengthMm": wire,
                  "peakRssBytes": 1024 * sample, "outputHash": f"output{sample}",
                  "stageTiming": {"status": timing_status or ("complete" if solved else "partial"), "stages": stages},
                  "errorPhaseName": phase, "error": "failure" if not solved else None,
                  "highDensity": {"solved": hd_solved if hd_solved is not None else bool(hd_ms is not None and phase != summary.HD_STAGE),
                                  "diagnostics": {"numeric": sample, "boolean": True, "text": "ignored"}},
                  "hdInput": {"sha256": hd_hash} if hd_ms is not None else None}
        report = {"variant": arm, "dataset": "srj18", "sampleNumber": sample,
                  "commit": next(source["commit"] for source in self.config["arms"] if source["id"] == arm),
                  "mode": "full", "effort": 1, "timeoutMs": 360_000,
                  "measurementProvenance": {"concurrency": 6, "workerSha256": "fixed", "armFingerprint": arm},
                  "result": result}
        path = self.root / "full" / arm / f"srj18-{sample:03d}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report))
        return path

    def contrast(self, result, name="control--lazy"):
        return next(row for row in result["contrasts"] if row["id"] == name and row["dataset"] == "srj18")

    def test_direct_contrasts_use_distinct_explicit_cohorts_and_finite_wire(self):
        self.record("control", 1)
        self.record("old-clock", 1, elapsed=8_000, hd_ms=4_000)
        self.record("lazy", 1, elapsed=6_000, hd_ms=3_000, via=7, wire=None)
        self.record("control", 2, elapsed=20_000, hd_ms=8_000, via=100, wire=1000)
        self.record("old-clock", 2, elapsed=18_000, hd_ms=6_000)
        self.record("lazy", 2, elapsed=12_000, solved=False, clean=False, hd_ms=4_000, phase="repair", via=0, wire=0)
        self.record("control", 3, elapsed=30_000, hd_ms=5_000)
        self.record("lazy", 3, elapsed=15_000, hd_ms=1_000, hd_hash="changed", wire=55)
        self.record("control", 4, elapsed=360_000, solved=False, clean=False, hd_ms=355_000, phase=summary.HD_STAGE, timeout=True)
        self.record("lazy", 4, elapsed=360_000, solved=False, clean=False, hd_ms=355_000, phase=summary.HD_STAGE, timeout=True)
        result = summary.build(self.root, self.config)
        contrast = self.contrast(result)
        self.assertEqual(result["schemaVersion"], 2)
        self.assertEqual(result["resultCount"], 10)
        self.assertEqual(result["resultProtocol"]["expectedCount"], 126)
        self.assertFalse(result["resultProtocol"]["complete"])
        self.assertEqual(contrast["commonClean"]["sampleNumbers"], [1, 3])
        self.assertAlmostEqual(contrast["commonClean"]["speedup"], 40 / 21)
        self.assertEqual(contrast["commonClean"]["vias"]["beforeSum"], 10)
        self.assertEqual(contrast["commonClean"]["vias"]["afterSum"], 12)
        self.assertEqual(contrast["commonClean"]["wireLengthMm"]["sampleNumbers"], [3])
        self.assertEqual(contrast["commonClean"]["wireLengthMm"]["missingSampleNumbers"], [1])
        self.assertEqual(contrast["commonClean"]["wireLengthMm"]["beforeSum"], 50)
        self.assertEqual(contrast["commonClean"]["wireLengthMm"]["afterSum"], 55)
        self.assertEqual(contrast["sameInputCompletedHd"]["sampleNumbers"], [1, 2])
        self.assertAlmostEqual(contrast["sameInputCompletedHd"]["speedup"], 13 / 7)
        self.assertEqual(contrast["commonCleanStageTimes"][summary.HD_STAGE]["sampleNumbers"], [1])
        self.assertEqual(contrast["stageCensoring"][summary.HD_STAGE]["beforeCensoredSampleNumbers"], [4])
        self.assertEqual(contrast["stageCensoring"]["repair"]["afterCensoredSampleNumbers"], [2])
        direct = self.contrast(result, "refinement")
        self.assertEqual(direct["sameInputCompletedHd"]["sampleNumbers"], [1, 2])
        self.assertAlmostEqual(direct["sameInputCompletedHd"]["speedup"], 10 / 7)
        self.assertEqual(direct["outputHashMatches"]["pairedSolvedSampleNumbers"], [1])
        self.assertEqual(direct["outputHashMatches"]["matchedSampleNumbers"], [1])
        self.assertEqual(direct["diagnosticCounters"]["sameInputCompletedHd"]["beforeTotals"], {"numeric": 3})
        self.assertEqual(direct["diagnosticCounters"]["sameInputCompletedHd"]["afterTotals"], {"numeric": 3})
        self.assertEqual(direct["diagnosticCounters"]["sameInputCompletedHd"]["matchedCounters"]["numeric"]["equalSampleNumbers"], [1, 2])
        row = next(row for row in result["rows"] if row["arm"] == "lazy" and row["dataset"] == "srj18")
        self.assertEqual(row["failurePenalizedSecondsSum"], 741)
        self.assertEqual(row["numericDiagnosticTotals"], {"numeric": 10})
        self.assertEqual(row["concurrencyValues"], [6])
        self.assertEqual(row["source"]["commit"], "new")
        self.assertEqual(row["rawStageTimes"]["repair"]["completedSampleNumbers"], [])
        self.assertEqual(row["rawStageTimes"]["repair"]["censoredSampleNumbers"], [2])
        self.assertEqual(result["perSampleDiagnostics"][0]["diagnostics"], {"numeric": 1})
        self.assertIn("Finite wire pairs", summary.markdown(result))
        json.dumps(result, allow_nan=False)

    def test_missing_active_phase_does_not_promote_censored_last_stage(self):
        self.record("control", 1, solved=False, clean=False, timing_status="partial", hd_solved=False)
        self.record("lazy", 1, solved=False, clean=False, timing_status="partial", hd_solved=False)
        self.assertEqual(self.contrast(summary.build(self.root, self.config))["sameInputCompletedHd"]["count"], 0)
        self.record("control", 1, solved=False, clean=False, timing_status="partial", hd_solved=True)
        self.record("lazy", 1, solved=False, clean=False, timing_status="partial", hd_solved=True)
        self.assertEqual(self.contrast(summary.build(self.root, self.config))["sameInputCompletedHd"]["sampleNumbers"], [1])

    def test_output_and_counter_missing_values_keep_explicit_coverage(self):
        self.record("old-clock", 1)
        changed = self.record("lazy", 1)
        record = json.loads(changed.read_text())
        record["result"]["outputHash"] = "different"
        record["result"]["highDensity"]["diagnostics"] = {"numeric": 2, "newCounter": 7}
        changed.write_text(json.dumps(record))
        self.record("old-clock", 2)
        missing = self.record("lazy", 2)
        record = json.loads(missing.read_text())
        record["result"]["outputHash"] = None
        record["result"]["highDensity"]["diagnostics"] = {}
        missing.write_text(json.dumps(record))
        contrast = self.contrast(summary.build(self.root, self.config), "refinement")
        self.assertEqual(contrast["outputHashMatches"]["pairedSolvedSampleNumbers"], [1, 2])
        self.assertEqual(contrast["outputHashMatches"]["mismatchedSampleNumbers"], [1])
        self.assertEqual(contrast["outputHashMatches"]["missingHashSampleNumbers"], [2])
        counters = contrast["diagnosticCounters"]["matched"]
        self.assertEqual(counters["beforeTotals"]["numeric"], 3)
        self.assertEqual(counters["afterTotals"]["numeric"], 2)
        self.assertEqual(counters["matchedCounters"]["numeric"]["beforeSum"], 1)
        self.assertEqual(counters["matchedCounters"]["numeric"]["afterSum"], 2)
        self.assertEqual(counters["matchedCounters"]["numeric"]["missingAfterSampleNumbers"], [2])
        self.assertEqual(counters["matchedCounters"]["newCounter"]["count"], 0)
        self.assertEqual(counters["matchedCounters"]["newCounter"]["missingBeforeSampleNumbers"], [1, 2])

    def test_source_srj_and_raw_constructor_cohorts_remain_distinct(self):
        def source_record(arm, sample, srj_hash, raw_hash, scenario_hash, censored=False):
            path = self.record(arm, sample, hd_hash=raw_hash,
                               solved=not censored, clean=not censored,
                               phase=summary.HD_STAGE if censored else None,
                               timeout=censored)
            record = json.loads(path.read_text())
            if not censored:
                record["result"]["stageTiming"]["stages"].append({"stageName": "repair", "elapsedTimeMs": 1_000})
            record["result"]["sourceProblem"] = {
                "schemaVersion": 1, "srjSha256": srj_hash,
                "scenarioSha256": scenario_hash, "scenarioName": "fixture",
                "clearanceRuleDeclarations": {"minTraceGap": 0.1}}
            record["result"]["hdInput"]["rawConstructorContext"] = {
                "fieldNames": ["nodePortPoints"] if arm == "control" else ["nodePortPoints", "npthHoleClearance"],
                "clearanceRuleDeclarations": {} if arm == "control" else {"npthHoleClearance": 0.2}}
            path.write_text(json.dumps(record))

        source_record("control", 1, "same-srj", "old-raw", "scenario-a")
        source_record("lazy", 1, "same-srj", "new-raw", "scenario-b")
        initial = self.contrast(summary.build(self.root, self.config))
        self.assertEqual(initial["sameRawConstructorCompletedHd"]["count"], 0)
        self.assertEqual(initial["sameInputCompletedHd"]["count"], 0)
        self.assertEqual(initial["sameSourceSrjCompletedHd"]["sampleNumbers"], [1])
        self.assertEqual(initial["sameSourceScenario"]["count"], 0)
        self.assertEqual(initial["rawConstructorCompletedStageTimes"][summary.HD_STAGE]["sampleNumbers"], [])
        self.assertEqual(initial["sourceSrjCompletedStageTimes"][summary.HD_STAGE]["sampleNumbers"], [1])
        self.assertEqual(initial["sourceSrjCommonCleanStageTimes"][summary.HD_STAGE]["sampleNumbers"], [1])
        self.assertEqual(initial["rawConstructorCompletedStageTimes"]["repair"]["sampleNumbers"], [])
        self.assertEqual(initial["sourceSrjCompletedStageTimes"]["repair"]["sampleNumbers"], [1])
        self.assertEqual(initial["pairs"][0]["beforeSourceProblem"]["srjSha256"], "same-srj")
        self.assertEqual(initial["pairs"][0]["afterHdInput"]["rawConstructorContext"]["clearanceRuleDeclarations"], {"npthHoleClearance": 0.2})

        source_record("control", 2, "same-srj", "old-raw", "scenario", censored=True)
        source_record("lazy", 2, "same-srj", "new-raw", "scenario", censored=True)
        source_record("control", 3, None, "same-raw", None)
        source_record("lazy", 3, None, "same-raw", None)
        source_record("control", 4, "", "", "")
        source_record("lazy", 4, "", "", "")
        source_record("control", 5, "different-srj-a", "raw-a", "same-scenario")
        source_record("lazy", 5, "different-srj-b", "raw-b", "same-scenario")
        result = summary.build(self.root, self.config)
        contrast = self.contrast(result)
        self.assertEqual(contrast["sameRawConstructorCompletedHd"]["sampleNumbers"], [3])
        self.assertEqual(contrast["sameSourceSrjCompletedHd"]["sampleNumbers"], [1])
        self.assertEqual(contrast["sameSourceSrj"]["sampleNumbers"], [1, 2])
        self.assertEqual(contrast["sameSourceScenario"]["sampleNumbers"], [2, 5])
        self.assertEqual(contrast["sourceSrjStageCensoring"][summary.HD_STAGE]["beforeCensoredSampleNumbers"], [2])
        self.assertEqual(contrast["sourceSrjStageCensoring"][summary.HD_STAGE]["afterCensoredSampleNumbers"], [2])
        self.assertEqual(contrast["diagnosticCounters"]["sameSourceSrjCompletedHd"]["sampleNumbers"], [1])
        self.assertEqual(result["perSampleDiagnostics"][0]["sourceProblem"]["srjSha256"], "same-srj")
        self.assertIn("Raw HD speed", summary.markdown(result))
        self.assertIn("SRJ HD speed", summary.markdown(result))

    def test_source_settings_and_unexpected_records_are_rejected(self):
        path = self.record("control", 1)
        original = json.loads(path.read_text())
        for field, value in [("commit", "wrong"), ("effort", 2), ("timeoutMs", 10), ("sampleNumber", 17), ("mode", "hd")]:
            modified = copy.deepcopy(original)
            modified[field] = value
            path.write_text(json.dumps(modified))
            with self.assertRaises(ValueError):
                summary.build(self.root, self.config)
        path.write_text(json.dumps(original))
        duplicate = path.with_name("duplicate.json")
        duplicate.write_text(path.read_text())
        with self.assertRaisesRegex(ValueError, "Duplicate result"):
            summary.build(self.root, self.config)

    def test_invalid_configs_are_rejected_and_empty_evidence_stays_incomplete(self):
        variants = []
        duplicate = copy.deepcopy(self.config)
        duplicate["arms"].append(duplicate["arms"][0])
        variants.append(duplicate)
        absent = copy.deepcopy(self.config)
        absent["baselineArm"] = "missing"
        variants.append(absent)
        self_contrast = copy.deepcopy(self.config)
        self_contrast["contrasts"] = [{"before": "lazy", "after": "lazy"}]
        variants.append(self_contrast)
        repeated = copy.deepcopy(self.config)
        repeated["contrasts"].append(repeated["contrasts"][0])
        variants.append(repeated)
        for config in variants:
            with self.assertRaises(ValueError):
                summary.build(self.root, config)
        result = summary.build(self.root, self.config)
        self.assertEqual(result["resultCount"], 0)
        self.assertEqual(len(result["rows"]), 6)
        self.assertIsNone(result["contrasts"][0]["commonClean"]["speedup"])
        self.assertEqual(len(result["resultProtocol"]["missing"]), 126)


if __name__ == "__main__":
    unittest.main()
