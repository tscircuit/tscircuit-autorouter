#!/usr/bin/env python3
import argparse
import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("targeted_scope", ROOT / "run-targeted-forest-scope.py")
targeted = importlib.util.module_from_spec(spec)
spec.loader.exec_module(targeted)


class TargetedScopeTest(unittest.TestCase):
    def test_exact_targeted_scope_preserves_original_inputs_runner_and_censoring(self):
        manifest_path = ROOT / "targeted-forest-scope-manifest.json"
        manifest, experiment = targeted.validate_manifest(manifest_path)
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            invalid = copy.deepcopy(manifest)
            invalid["candidatePublication"]["status"] = "PENDING_UNPUBLISHED"
            invalid["candidatePublication"]["publishedCommit"] = None
            invalid["experiments"][0]["candidateSha"] = None
            path = directory / "invalid.json"
            path.write_text(json.dumps(invalid))
            with self.assertRaises(ValueError):
                targeted.validate_manifest(path)
            for mutate in [lambda d: d["targetedSampleNumbers"]["srj18"].append(1), lambda d: d["experiments"][0]["options"].update(cacheProvider={}), lambda d: d.update(sampleTimeoutSeconds=359), lambda d: d["experiments"][0].update(candidateSha="main"), lambda d: d["candidatePublication"].update(publishedCommit="b" * 40), lambda d: d["runtimeSourceHashes"].update({"run-pinned-experiment.py": "0" * 64})]:
                invalid = copy.deepcopy(manifest)
                mutate(invalid)
                path.write_text(json.dumps(invalid))
                with self.assertRaises(ValueError):
                    targeted.validate_manifest(path)
            plan = subprocess.run(["python3", str(ROOT / "run-targeted-forest-scope.py"), "--mode", "plan", "--manifest", str(manifest_path)], capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(plan.stdout), {"include": [{"pr": 3198, "dataset": "srj18", "targetedSampleCount": 1, "originalSamples": "4"}, {"pr": 3198, "dataset": "srj24", "targetedSampleCount": 4, "originalSamples": "5,9,10,16"}]})
            all_calls = []
            text = io.StringIO()
            for dataset, count in [("srj18", 16), ("srj24", 26)]:
                population = [{"sampleNumber": n, "scenarioName": f"original-{dataset}-{n}", "inputHash": manifest["expectedInputHashesByDataset"][dataset][str(n)]} for n in range(1, count + 1)]
                selected = targeted.preflight_selection(manifest, dataset, {"A": population, "B": copy.deepcopy(population)})
                self.assertEqual([row["sampleNumber"] for row in selected], targeted.TARGETS[dataset])
                for mutation in ["hash", "renumber"]:
                    bad = copy.deepcopy(population)
                    bad[0]["inputHash" if mutation == "hash" else "sampleNumber"] = "0" * 64 if mutation == "hash" else 0
                    with self.assertRaises(ValueError):
                        targeted.preflight_selection(manifest, dataset, {"A": bad, "B": copy.deepcopy(bad)})
                checkouts = {}
                for arm in ["A", "B"]:
                    checkout = directory / f"{dataset}-{arm}"
                    checkout.mkdir()
                    checkouts[arm] = checkout
                    harness = {**manifest["expectedHarnessSourceHashes"], "checkoutSha": manifest["baselineSha"] if arm == "A" else experiment["candidateSha"], "validators": manifest["expectedValidatorHashes"], "adaptedHarnessHash": "c" * 64, "adapterHash": manifest["runtimeSourceHashes"]["experiment-audit-adapter.ts"], "dependencyResolution": {"directDependencies": {}, "installedPackages": []}}
                    (checkout / "experiment-harness-provenance.json").write_text(json.dumps(harness))
                def fake_run(checkout, config_path, output, original_dataset, sample, timeout):
                    arm = checkout.name[-1]
                    all_calls.append((original_dataset, sample, arm, timeout, output.name, output.parent.name, json.loads(config_path.read_text())["options"]))
                    return {"official": {"sampleNumber": sample, "didSolve": True, "didTimeout": False, "relaxedDrcPassed": True, "elapsedTimeMs": 10 if arm == "A" else 8, "viaCount": 2 if arm == "A" else 1}, "controllerError": None, "supplemental": None}
                args = argparse.Namespace(dataset=dataset, baseline=checkouts["A"], candidate=checkouts["B"], output=directory / (dataset + "-results"))
                with mock.patch.object(targeted.pinned, "read_identity", side_effect=lambda checkout, ds: copy.deepcopy(population)), mock.patch.object(targeted.pinned, "run_sample", side_effect=fake_run), contextlib.redirect_stdout(text):
                    summary = targeted.run_targeted(args, manifest, experiment)
                self.assertEqual(summary["targetedSampleCount"], len(targeted.TARGETS[dataset]))
                self.assertEqual(summary["fullDatasetSampleCount"], count)
                self.assertTrue(summary["targetedFirstRoundComplete"])
                self.assertFalse(summary["fullPopulationComplete"])
                self.assertFalse(summary["isFullCorpusSweep"])
                self.assertEqual(summary["officialCleanCount"], {"A": len(selected), "B": len(selected)})
                self.assertEqual(summary["mutuallyOfficialCleanSamples"], targeted.TARGETS[dataset])
                provenance = json.loads((args.output / "provenance.json").read_text())
                self.assertEqual(provenance["inputPopulation"], population)
                self.assertEqual(provenance["targetedInputPopulation"], selected)
                records = [json.loads(line) for line in (args.output / "targeted-results.jsonl").read_text().splitlines()]
                self.assertEqual([(r["sampleNumber"], r["arm"]) for r in records], [(n, arm) for n in targeted.TARGETS[dataset] for arm in ["A", "B"]])
                self.assertTrue(all(r["expectedInputHash"] == manifest["expectedInputHashesByDataset"][dataset][str(r["sampleNumber"])] for r in records))
                self.assertEqual(sorted(str(p.relative_to(args.output)) for p in args.output.glob("round-1/sample-*/?/audit-result.json")), sorted(f"round-1/sample-{n:03d}/{arm}/audit-result.json" for n in targeted.TARGETS[dataset] for arm in ["A", "B"]))
                with self.assertRaises(ValueError), mock.patch.object(targeted.pinned, "read_identity") as forbidden:
                    targeted.run_targeted(args, manifest, experiment)
                forbidden.assert_not_called()
            self.assertEqual([(ds, sample, arm) for ds, sample, arm, *_ in all_calls], [(ds, sample, arm) for ds in ["srj18", "srj24"] for sample in targeted.TARGETS[ds] for arm in ["A", "B"]])
            self.assertTrue(all(timeout == 360 and arm == output_name and directory_name == f"sample-{sample:03d}" for ds, sample, arm, timeout, output_name, directory_name, options in all_calls))
            self.assertTrue(all(options == ({"cacheProvider": None, "effort": 1} if arm == "A" else {"cacheProvider": None, "effort": 1, "usePhysicalNetForest": True}) for ds, sample, arm, timeout, output_name, directory_name, options in all_calls))
            self.assertNotIn("EXPERIMENT_RESULT_JSON ", text.getvalue())
            self.assertNotIn("EXPERIMENT_SUMMARY_JSON ", text.getvalue())
            self.assertEqual(text.getvalue().count("TARGETED_SCOPE_RESULT_JSON "), 10)
            self.assertEqual(text.getvalue().count("TARGETED_SCOPE_SUMMARY_JSON "), 2)
            baseline = {"sampleNumber": 4, "round": 1, "arm": "A", "controllerError": None, "official": {"didSolve": True, "didTimeout": False, "relaxedDrcPassed": True, "elapsedTimeMs": 50, "viaCount": 2}}
            missing = targeted.summarize_targeted([baseline], "srj18")
            self.assertEqual(missing["cleanRegressions"], [])
            self.assertFalse(missing["targetedFirstRoundComplete"])
            failed = {**baseline, "arm": "B", "official": {"didSolve": False, "didTimeout": False, "relaxedDrcPassed": False, "elapsedTimeMs": 1, "viaCount": 0}}
            result = targeted.summarize_targeted([baseline, failed], "srj18")
            self.assertEqual(result["cleanRegressions"], [4])
            self.assertEqual(result["mutuallyOfficialCleanSamples"], [])
            self.assertIsNone(result["targetedMutuallyCleanMedianCandidateBaselineTimeRatio"])
            self.assertEqual(result["targetedMutuallyCleanRoutingTimeTotalsMs"], {"A": 0, "B": 0})
            for invalid in [[baseline, baseline], [{**baseline, "sampleNumber": 1}], [{**baseline, "round": 2}]]:
                with self.assertRaises(ValueError):
                    targeted.summarize_targeted(invalid, "srj18")


if __name__ == "__main__":
    unittest.main()
