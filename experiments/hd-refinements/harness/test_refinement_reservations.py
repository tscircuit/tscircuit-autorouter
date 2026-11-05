import json
from pathlib import Path
import tempfile
import unittest

from build_refinement_reservations import build, estimate_bytes, EXPECTED_BOARDS, GIB, QUARTER_GIB
from memory_scheduler import MemoryReservationScheduler


class RefinementReservationsTest(unittest.TestCase):
    def test_static_table_maximum_provenance_coverage_and_admission(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous = root / "previous.json"
            previous.write_text(json.dumps({"schemaVersion": 1, "samples": {
                f"{dataset}:{sample}": {"observedPeakRssBytes": GIB}
                for dataset, sample in EXPECTED_BOARDS}}))
            full = root / "archives" / "synthetic" / "artifact" / "full"
            for arm in ["control", "experiment"]:
                (full / arm).mkdir(parents=True)
                for dataset, sample in EXPECTED_BOARDS:
                    rss = 16 * GIB if (arm, dataset, sample) == ("experiment", "srj24", 1) else GIB // 2
                    (full / arm / f"{dataset}-{sample:03d}.json").write_text(json.dumps({
                        "variant": arm, "commit": arm * 4, "dataset": dataset, "sampleNumber": sample,
                        "result": {"peakRssBytes": rss}}))
            policy = build(previous, root / "archives", expected_cohorts=1)
            self.assertEqual(policy, build(previous, root / "archives", expected_cohorts=1), "Generation must be deterministic")
            self.assertEqual(len(policy["samples"]), 42)
            self.assertEqual(policy["provenance"]["archivedRecordCount"], 84)
            self.assertEqual(policy["provenance"]["observationCount"], 126)
            heavy = policy["samples"]["srj24:1"]
            self.assertEqual(heavy["observedPeakRssBytes"], 16 * GIB)
            self.assertEqual(heavy["estimatedPeakWithMarginBytes"], 24 * GIB + GIB // 2)
            self.assertEqual(heavy["reservationBytes"], 13 * GIB)
            self.assertTrue(heavy["exclusive"])
            self.assertEqual(heavy["observations"][0]["variant"], "experiment")
            self.assertEqual(policy["samples"]["srj18:1"]["observedPeakRssBytes"], GIB)
            self.assertEqual(estimate_bytes(GIB, ("srj18", 1)), 2 * GIB)
            self.assertEqual(estimate_bytes(1, ("srj18", 1)), 5 * GIB // 4)
            self.assertEqual(estimate_bytes(1, ("srj24", 11)), 8 * GIB)
            self.assertEqual(estimate_bytes(GIB + 1, ("srj18", 1)), 2 * GIB + QUARTER_GIB)
            with self.assertRaises(ValueError):
                build(previous, root / "archives", expected_cohorts=9)
            missing = full / "control" / "srj18-001.json"
            missing.unlink()
            with self.assertRaises(ValueError):
                build(previous, root / "archives", expected_cohorts=1)

        # Check the actual checked-in table with both resource profiles. Each
        # arm gets the identical board estimate; simulated completion is only
        # a scheduler protocol test and never launches a solver.
        policy = json.loads(Path(__file__).with_name("memory-reservations.json").read_text())
        self.assertEqual(len(policy["samples"]), 42)
        self.assertEqual(policy["provenance"]["archivedCohortCount"], 9)
        self.assertEqual(policy["provenance"]["archivedRecordCount"], 756)
        self.assertEqual(policy["provenance"]["observationCount"], 798)
        for budget, lanes, overlap in [(13 * GIB, 3, False), (48 * GIB, 6, True)]:
            tasks = []
            for key, row in policy["samples"].items():
                self.assertEqual(row["observationCount"], 19)
                self.assertEqual(row["observedPeakRssBytes"], max(record["peakRssBytes"] for record in row["observations"]))
                estimate = row["estimatedPeakWithMarginBytes"] if overlap else row["reservationBytes"]
                exclusive = estimate > budget or row["exclusive"] and not overlap
                for arm in range(7):
                    tasks.append({"resultPath": f"{key}/{arm}", "memoryReservationBytes": budget if exclusive else estimate,
                        "memoryExclusive": exclusive})
            scheduler = MemoryReservationScheduler(tasks, budget)
            completed = 0
            while scheduler.pending_count or scheduler.active:
                for slot in range(lanes):
                    if slot in scheduler.active:
                        continue
                    task = scheduler.admit(slot)
                    if task:
                        self.assertLessEqual(scheduler.reserved_bytes(), budget)
                        if task["memoryExclusive"]:
                            self.assertEqual(len(scheduler.active), 1)
                self.assertTrue(scheduler.active, "Admission must never deadlock")
                scheduler.release(min(scheduler.active))
                completed += 1
            self.assertEqual(completed, 294)


if __name__ == "__main__":
    unittest.main()
