#!/usr/bin/env python3
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pinned_runner", ROOT / "run-pinned-experiment.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
plan_spec = importlib.util.spec_from_file_location("pinned_plan", ROOT / "plan-pinned-matrix.py")
planner = importlib.util.module_from_spec(plan_spec)
plan_spec.loader.exec_module(planner)


class PinnedControllerTests(unittest.TestCase):
    def test_progressive_matrix_ignores_unrequested_pending_shas(self):
        manifest = json.loads((ROOT / "pinned-manifest.template.json").read_text())
        manifest["runPrNumbers"] = [3198, 3202]
        for item in manifest["experiments"]:
            if item["pr"] in manifest["runPrNumbers"]:
                item["candidateSha"] = manifest["baselineSha"]
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest))
            matrix = planner.create_matrix(path)
        self.assertEqual(matrix["include"], [{"pr": pr, "dataset": dataset} for pr in [3198, 3202] for dataset in ["srj18", "srj24"]])

    def test_progressive_matrix_rejects_requested_pending_sha(self):
        manifest = json.loads((ROOT / "pinned-manifest.template.json").read_text())
        manifest["runPrNumbers"] = [3199]
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                planner.create_matrix(path)

    def test_moving_ref_is_rejected(self):
        manifest = json.loads((ROOT / "pinned-manifest.template.json").read_text())
        manifest["experiments"][0]["candidateSha"] = "main"
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                runner.selector.select(path, 3198, "srj18")

    def test_cache_on_is_rejected(self):
        manifest = json.loads((ROOT / "pinned-manifest.template.json").read_text())
        manifest["experiments"][0]["candidateSha"] = manifest["baselineSha"]
        manifest["baseline"]["options"]["cacheProvider"] = {}
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "manifest.json"
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                runner.selector.select(path, 3198, "srj18")

    def test_failed_fast_solver_is_not_a_timing_or_via_win(self):
        records = [
            {"sampleNumber": 1, "arm": "A", "round": 1, "controllerError": None,
             "official": {"didSolve": True, "didTimeout": False, "relaxedDrcPassed": True, "elapsedTimeMs": 50, "viaCount": 2}},
            {"sampleNumber": 1, "arm": "B", "round": 1, "controllerError": None,
             "official": {"didSolve": False, "didTimeout": False, "relaxedDrcPassed": False, "elapsedTimeMs": 1, "viaCount": 0}},
        ]
        result = runner.summarize(records, 1)
        self.assertEqual(result["cleanRegressions"], [1])
        self.assertEqual(result["mutuallyOfficialCleanSamples"], [])
        self.assertIsNone(result["mutuallyCleanMedianCandidateBaselineTimeRatio"])

    def test_replication_never_replaces_first_round_failure(self):
        first = {"sampleNumber": 1, "arm": "B", "round": 1, "controllerError": None,
                 "official": {"didSolve": False, "didTimeout": True, "relaxedDrcPassed": False, "elapsedTimeMs": 360000}}
        second = {**first, "round": 2, "official": {"didSolve": True, "didTimeout": False, "relaxedDrcPassed": True, "elapsedTimeMs": 10}}
        self.assertEqual(runner.summarize([first, second], 1)["officialCleanCount"]["B"], 0)

    def test_different_resolution_of_same_declaration_is_rejected(self):
        def harness(version):
            return {"dependencyResolution": {"directDependencies": {"math": {"declaration": "^1", "resolvedVersion": version}}, "installedPackages": []}}
        with self.assertRaises(ValueError):
            runner.compare_dependency_resolutions({"A": harness("1.0"), "B": harness("1.1")})

    def test_critical_transitive_mismatch_is_rejected(self):
        def harness(version):
            return {"dependencyResolution": {"directDependencies": {}, "installedPackages": [{"name": "@tscircuit/checks", "version": version, "packageJsonSha256": version}]}}
        with self.assertRaises(ValueError):
            runner.compare_dependency_resolutions({"A": harness("1.0"), "B": harness("1.1")})

    def test_timeout_kills_descendants(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            marker = root / "child-pid"
            command = [sys.executable, "-c", "import pathlib,subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']); pathlib.Path(sys.argv[1]).write_text(str(p.pid)); time.sleep(60)", str(marker)]
            with (root / "log").open("w") as log:
                code, timed_out = runner.execute_with_deadline(command, root, os.environ.copy(), log, 0.3)
            self.assertTrue(timed_out)
            self.assertIsNone(code)
            stat = pathlib.Path("/proc") / marker.read_text() / "stat"
            if stat.exists():
                self.assertEqual(stat.read_text().split()[2], "Z")


if __name__ == "__main__":
    unittest.main()
