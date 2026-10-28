#!/usr/bin/env python3
"""Mock only the already-tested raw helpers; exercise the new provenance boundary."""
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("targeted_inspector", HERE / "inspect-targeted-forest-scope-artifact.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class TargetedInspectionTest(unittest.TestCase):
    def test_strict_original_number_scope_and_provenance_before_unchanged_raw_helpers(self):
        pins = json.loads((HERE / "test-targeted-source-pins.json").read_text())
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            for dataset in ["srj18", "srj24"]:
                manifest = pins["controllerManifest"]
                selected = audit.TARGETS[dataset]
                full_hashes = manifest["expectedInputHashesByDataset"][dataset]
                expected = {**audit.PINS, "dataset": dataset, "qualificationScope": audit.SCOPE, "fullPopulationComplete": False, "isFullCorpusSweep": False, "targetedSampleNumbers": selected, "fullDatasetSampleCount": audit.COUNTS[dataset], "fullInputHashes": full_hashes, "inputHashes": {str(n): full_hashes[str(n)] for n in selected}, "controllerManifest": manifest, "configs": {"A": manifest["baseline"], "B": manifest["experiments"][0]}, "artifact": {"id": 1, "name": f"targeted-forest-scope-3198-{dataset}", "sizeBytes": 100, "digest": "sha256:" + "d" * 64}, "runtimeSourceHashes": manifest["runtimeSourceHashes"], "runSampleSourceSha256": manifest["runSampleSourceSha256"], "targetedWrapperSha256": pins["targetedWrapperSha256"], "harnessSourceHashes": manifest["expectedHarnessSourceHashes"], "validatorHashes": manifest["expectedValidatorHashes"]}
                self.assertEqual(audit.validate_expected(expected), selected)
                for mutation in [lambda d: d.update(fullPopulationComplete=True), lambda d: d.update(targetedSampleNumbers=[1]), lambda d: d.update(controllerSha="b" * 40), lambda d: d["controllerManifest"].update(sampleTimeoutSeconds=359), lambda d: d["inputHashes"].update({str(selected[0]): "0" * 64})]:
                    invalid = copy.deepcopy(expected)
                    mutation(invalid)
                    with self.assertRaises(ValueError):
                        audit.validate_expected(invalid)
                metadata = {"qualification": "EXACT_ARTIFACT_METADATA_VERIFIED", "issues": [], "metadata": {"id": 1, "name": expected["artifact"]["name"], "size_in_bytes": 100, "digest": expected["artifact"]["digest"], "expired": False, "workflow_run": {"id": audit.PINS["runId"], "head_sha": audit.PINS["controllerSha"], "head_branch": audit.PINS["controllerBranch"]}}}
                root = directory / dataset
                root.mkdir()
                def write(path, value):
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps(value))
                full_population = [{"sampleNumber": n, "scenarioName": f"original-{dataset}-{n}", "inputHash": full_hashes[str(n)]} for n in range(1, audit.COUNTS[dataset] + 1)]
                harnesses = {arm: {**expected["harnessSourceHashes"], "checkoutSha": expected["baselineSha" if arm == "A" else "candidateSha"], "adaptedHarnessHash": "c" * 64, "adapterHash": expected["runtimeSourceHashes"]["experiment-audit-adapter.ts"], "validators": expected["validatorHashes"]} for arm in ["A", "B"]}
                provenance = {"manifest": manifest, "experiment": expected["configs"]["B"], "dataset": dataset, "githubRunId": str(expected["runId"]), "controllerSha": expected["controllerSha"], "qualificationScope": audit.SCOPE, "targetedSampleNumbers": selected, "targetedSampleCount": len(selected), "fullDatasetSampleCount": audit.COUNTS[dataset], "fullPopulationComplete": False, "inputPopulation": full_population, "targetedInputPopulation": [row for row in full_population if row["sampleNumber"] in selected], "harnesses": harnesses, "runtimeVerification": {field: expected[field] for field in ["runtimeSourceHashes", "runSampleSourceSha256", "targetedWrapperSha256"]}}
                write(root / "provenance.json", provenance)
                records = {}
                for arm in ["A", "B"]:
                    write(root / f"config-{arm}.json", expected["configs"][arm])
                    for sample in selected:
                        record = {"round": 1, "sampleNumber": sample, "scenarioName": f"original-{dataset}-{sample}", "arm": arm, "qualificationScope": audit.SCOPE, "pr": 3198, "dataset": dataset, "sha": expected["baselineSha" if arm == "A" else "candidateSha"], "solverName": expected["configs"][arm]["solverName"], "expectedInputHash": full_hashes[str(sample)], "targetedSampleNumbers": selected, "fullPopulationComplete": False, "controllerError": None, "official": {"sampleNumber": sample, "didSolve": True, "didTimeout": False, "relaxedDrcPassed": True, "elapsedTimeMs": 10 if arm == "A" else 8, "viaCount": 2 if arm == "A" else 1}}
                        path = root / "round-1" / f"sample-{sample:03d}" / arm / "audit-result.json"
                        write(path, record)
                        write(path.parent / "raw/capture-provenance.json", {"mockRawHelperBoundaryOnly": True})
                        records[sample, arm] = (record, path)
                summary = {"qualificationScope": audit.SCOPE, "targetedSampleNumbers": selected, "targetedSampleCount": len(selected), "fullDatasetSampleCount": audit.COUNTS[dataset], "fullPopulationComplete": False, "isFullCorpusSweep": False, "firstRoundAttemptCount": len(selected) * 2, "targetedFirstRoundComplete": True, "officialCleanCount": {"A": len(selected), "B": len(selected)}, "mutuallyOfficialCleanSamples": selected, "cleanGains": [], "cleanRegressions": [], "targetedMutuallyCleanRoutingTimeTotalsMs": {"A": len(selected) * 10, "B": len(selected) * 8}}
                write(root / "targeted-summary.json", summary)
                def fake_raw(raw, record, received_expected, issue, limit):
                    self.assertIs(received_expected, expected)
                    self.assertEqual(raw.parent.name, record["arm"])
                    self.assertEqual(raw.parent.parent.name, f"sample-{record['sampleNumber']:03d}")
                    return {"checks": {"referenceFullCopperChecks": {"count": 0, "byType": {}}}, "mockOnlyNoPhysicalClaim": True}
                def fake_identity(received_directory, received_expected, verified, include_baseline=False):
                    self.assertEqual(received_directory, root)
                    self.assertIs(received_expected, expected)
                    self.assertTrue(include_baseline)
                    self.assertEqual(verified["qualification"], "PROVENANCE_CHECKS_PASSED")
                    self.assertEqual(verified["sourceArtifact"], expected["artifact"])
                    return {"officialAndReferenceCleanSamplesByArm": {"A": selected, "B": selected}, "results": []}
                with mock.patch.object(audit.base, "inspect_raw", side_effect=fake_raw) as raw_query, mock.patch.object(audit.identity, "inspect", side_effect=fake_identity) as identity_query:
                    result = audit.inspect_targeted(root, expected, metadata)
                    self.assertEqual(result["qualification"], "TARGETED_SOURCE_PROVENANCE_CHECKS_PASSED")
                    self.assertEqual(result["integrityIssues"], [])
                    self.assertEqual(result["targetedSampleCount"], len(selected))
                    self.assertFalse(result["fullPopulationComplete"])
                    self.assertFalse(result["typedIdentity"]["fullPopulationComplete"])
                    self.assertEqual(raw_query.call_count, len(selected) * 2)
                    identity_query.assert_called_once()
                    raw_query.reset_mock()
                    identity_query.reset_mock()
                    invalid_metadata = copy.deepcopy(metadata)
                    invalid_metadata["metadata"]["workflow_run"]["head_sha"] = "b" * 40
                    bad = audit.inspect_targeted(root, expected, invalid_metadata)
                    self.assertTrue(bad["integrityIssues"])
                    raw_query.assert_not_called()
                    identity_query.assert_not_called()
                    for mutate in [lambda d: d.update(fullPopulationComplete=True), lambda d: d["inputPopulation"][0].update(inputHash="0" * 64), lambda d: d["targetedInputPopulation"][0].update(sampleNumber=1), lambda d: d["harnesses"]["B"].update(checkoutSha="b" * 40)]:
                        invalid = copy.deepcopy(provenance)
                        mutate(invalid)
                        write(root / "provenance.json", invalid)
                        self.assertTrue(audit.inspect_targeted(root, expected, metadata)["integrityIssues"])
                        raw_query.assert_not_called()
                        identity_query.assert_not_called()
                    write(root / "provenance.json", provenance)
                    sample = selected[0]
                    record, path = records[sample, "B"]
                    for mutate in [lambda d: d.update(sampleNumber=1), lambda d: d.update(expectedInputHash="0" * 64), lambda d: d.update(sha="b" * 40), lambda d: d.update(qualificationScope="FULL42")]:
                        invalid = copy.deepcopy(record)
                        mutate(invalid)
                        write(path, invalid)
                        self.assertTrue(audit.inspect_targeted(root, expected, metadata)["integrityIssues"])
                        raw_query.assert_not_called()
                        identity_query.assert_not_called()
                    write(path, record)
                    path.unlink()
                    self.assertTrue(audit.inspect_targeted(root, expected, metadata)["integrityIssues"])
                    raw_query.assert_not_called()
                    identity_query.assert_not_called()
                    write(path, record)
                    write(root / "duplicate/audit-result.json", record)
                    self.assertTrue(audit.inspect_targeted(root, expected, metadata)["integrityIssues"])
                    raw_query.assert_not_called()
                    identity_query.assert_not_called()
                    (root / "duplicate/audit-result.json").unlink()
                    invalid_summary = {**summary, "fullPopulationComplete": True}
                    write(root / "targeted-summary.json", invalid_summary)
                    self.assertTrue(audit.inspect_targeted(root, expected, metadata)["integrityIssues"])
                    raw_query.assert_not_called()
                    identity_query.assert_not_called()
                    # A valid official timeout has unavailable null metrics and
                    # no captured copper. It remains a failed targeted outcome.
                    timeout = copy.deepcopy(record)
                    timeout["official"] = {"sampleNumber": sample, "didSolve": False, "didTimeout": True, "relaxedDrcPassed": False, "elapsedTimeMs": 360000, "viaCount": None, "routingMetrics": None}
                    write(path, timeout)
                    (path.parent / "raw/capture-provenance.json").unlink()
                    remaining = [n for n in selected if n != sample]
                    timeout_summary = {**summary, "officialCleanCount": {"A": len(selected), "B": len(remaining)}, "mutuallyOfficialCleanSamples": remaining, "cleanRegressions": [sample], "targetedMutuallyCleanRoutingTimeTotalsMs": {"A": len(remaining) * 10, "B": len(remaining) * 8}}
                    write(root / "targeted-summary.json", timeout_summary)
                    raw_query.reset_mock()
                    identity_query.reset_mock()
                    identity_query.side_effect = None
                    identity_query.return_value = {"officialAndReferenceCleanSamplesByArm": {"A": selected, "B": remaining}, "results": []}
                    timeout_result = audit.inspect_targeted(root, expected, metadata)
                    self.assertEqual(timeout_result["qualification"], "TARGETED_SOURCE_PROVENANCE_CHECKS_PASSED")
                    self.assertEqual(timeout_result["integrityIssues"], [])
                    self.assertEqual(raw_query.call_count, len(selected) * 2 - 1)
                    identity_query.assert_called_once()
                    self.assertTrue(next(row for row in timeout_result["results"] if row["sample"] == sample and row["arm"] == "B")["official"]["didTimeout"])


if __name__ == "__main__":
    unittest.main()
