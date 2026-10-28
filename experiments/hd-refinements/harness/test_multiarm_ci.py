import contextlib
import copy
import io
import json
from pathlib import Path
import random
import tempfile
import unittest

from arm_profiles import LOCK_SHA256, canonical_sha
from configure_matrix import configure
from extract_refinement_summary import extract
from multiarm_ci import WORKER_SHA256, log_payload, validate_dependency_manifests, verify_records, sha, select_memory_profile
from memory_scheduler import MemoryReservationScheduler


class MultiarmCiTests(unittest.TestCase):
    def test_frozen_protocol_refuses_wrong_source_resources_and_dependency(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = configure("portfolio", "a" * 40, "b" * 40, root / "config.json")
            source_hashes = {"solverSourceTreeSha256": "c" * 64, "benchmarkSourceTreeSha256": "d" * 64, "routingSourceTreeSha256": "e" * 64}
            driver = {"workerSha256": WORKER_SHA256, "dependencyLockSha256": LOCK_SHA256, "measurementProtocolSha256": "f" * 64, "plannedQueueSha256": "8" * 64, "variants": {arm["id"]: source_hashes for arm in config["arms"]}}
            (root / "metadata.json").write_text(json.dumps(driver))
            metadata = {"concurrency": 6, "sampleCpus": list(range(6)), "memory": {"effectiveLimitBytes": 94 * 1024 ** 3, "MemAvailable": 70 * 1024 ** 3, **select_memory_profile(94 * 1024 ** 3, 70 * 1024 ** 3)}}
            policy = json.loads((Path(__file__).parent / "memory-reservations.json").read_text())
            for arm in config["arms"]:
                target = root / "full" / arm["id"]
                target.mkdir(parents=True)
                for dataset, count in [("srj18", 16), ("srj24", 26)]:
                    for number in range(1, count + 1):
                        report = {"variant": arm["id"], "commit": arm["commit"], "dataset": dataset, "sampleNumber": number, "effort": 1, "timeoutMs": 360000, "mode": "full", "cpu": 0, "sourceHashes": source_hashes, "result": {"didSolve": False, "sourceProblem": {"srjSha256": "1" * 64, "scenarioSha256": "2" * 64, "dataset": dataset, "sampleNumber": number}}, "measurementProvenance": {"measurementProtocolSha256": "f" * 64, "workerSha256": WORKER_SHA256, "dependencyLockSha256": LOCK_SHA256, "concurrency": 6, "cpus": "0,1,2,3,4,5", "memoryReservationBudgetBytes": 48 * 1024 ** 3, "memoryHeavyOverlapAllowed": True, "armConfigSha256": canonical_sha(config), "injectedSolverVariables": {}}}
                        report.update(routingStarted=True, startupTimedOut=False, memoryReservationBytes=policy["samples"][f"{dataset}:{number}"]["estimatedPeakWithMarginBytes"], memoryExclusive=False)
                        report["measurementProvenance"].update(memoryReservationPolicySha256=sha(Path(__file__).parent / "memory-reservations.json"), memorySchedulerSha256=sha(Path(__file__).parent / "memory_scheduler.py"), plannedQueueSha256="8" * 64, problemContextSha256=sha(Path(__file__).parent / "problem_context.ts"))
                        (target / f"{dataset}-{number:03d}.json").write_text(json.dumps(report))
            self.assertTrue(verify_records(root, config, metadata)["complete"])
            path = root / "full/control/srj18-001.json"
            valid = json.loads(path.read_text())
            for mutate in [lambda r: r.update(commit="0" * 40), lambda r: r["measurementProvenance"].update(concurrency=3), lambda r: r["measurementProvenance"].update(dependencyLockSha256="0" * 64), lambda r: r.update(cpu=10), lambda r: r.update(sourceHashes={}), lambda r: r.update(routingStarted=False), lambda r: r.update(memoryReservationBytes=1), lambda r: r["result"].update(sourceProblem={})]:
                report = copy.deepcopy(valid)
                mutate(report)
                path.write_text(json.dumps(report))
                self.assertFalse(verify_records(root, config, metadata)["complete"])
            path.unlink()
            proof = verify_records(root, config, metadata)
            self.assertFalse(proof["complete"])
            self.assertEqual(len(proof["missing"]), 1)
            archive = Path(__file__).parent / "dependencies/package.json"
            manifest_dir = root / "manifest-arm"
            manifest_dir.mkdir()
            manifest = json.loads(archive.read_text())
            (manifest_dir / "package.json").write_text(json.dumps(manifest))
            self.assertEqual(set(validate_dependency_manifests({"a": manifest_dir}, archive)), {"a"})
            manifest["dependencies"]["injected-package"] = "1.0.0"
            (manifest_dir / "package.json").write_text(json.dumps(manifest))
            with self.assertRaises(RuntimeError):
                validate_dependency_manifests({"a": manifest_dir}, archive)
            changed_archive = root / "changed-archive.json"
            archive_data = json.loads(archive.read_text())
            archive_data["scripts"] = {"injected": "changed outside dependency sections"}
            changed_archive.write_text(json.dumps(archive_data))
            with self.assertRaisesRegex(RuntimeError, "Archived generating dependency manifest changed"):
                validate_dependency_manifests({"a": manifest_dir}, changed_archive)

    def test_resource_profile_uses64_only_with80_gib_confirmed(self):
        gib = 1024 ** 3
        for effective, available, budget in [(94, 82, 64), (80, 80, 64), (94, 79.99, 48), (79.99, 94, 48), (56, 56, 48)]:
            profile = select_memory_profile(effective * gib, available * gib)
            self.assertEqual(profile["reservationBudgetGiB"], budget)
            self.assertEqual(profile["observedRssGuardGiB"], budget)
            self.assertEqual(profile["profile"], f"refinement-{budget}GiB")
        for effective, available in [(55.99, 94), (94, 55.99)]:
            with self.assertRaises(RuntimeError):
                select_memory_profile(effective * gib, available * gib)
        heavy = [{"memoryReservationBytes": int(24.25 * gib), "memoryExclusive": False} for _ in range(4)]
        large = MemoryReservationScheduler(heavy, 64 * gib)
        self.assertIsNotNone(large.admit(0))
        self.assertIsNotNone(large.admit(1))
        self.assertIsNone(large.admit(2))
        self.assertEqual(large.reserved_bytes(), int(48.5 * gib))
        fallback = MemoryReservationScheduler(heavy, 48 * gib)
        self.assertIsNotNone(fallback.admit(0))
        self.assertIsNone(fallback.admit(1))

    def test_chunked_log_export_verifies_complete_digest(self):
        rng = random.Random(24)
        payload = {"ci": {"complete": True}, "summary": {"resultCount": 168, "noise": "".join(rng.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=150000))}}
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            log_payload(payload)
        text = stream.getvalue()
        self.assertEqual(extract(text)[0], payload)
        self.assertGreater(text.count("HD_REFINEMENT_SUMMARY_CHUNK"), 1)
        self.assertLessEqual(max(map(len, text.splitlines())), 32100)
        for invalid in [text.replace("HD_REFINEMENT_SUMMARY_CHUNK 1/", "REMOVED_CHUNK 1/"), text.replace("HD_REFINEMENT_SUMMARY_END", "REMOVED_END")]:
            with self.assertRaises(ValueError):
                extract(invalid)


if __name__ == "__main__":
    unittest.main()
