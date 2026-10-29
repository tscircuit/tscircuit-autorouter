import unittest
import json
from pathlib import Path

from memory_scheduler import MemoryReservationScheduler


class MemorySchedulerTest(unittest.TestCase):
    def test_exclusive_reservations_scanning_growth_and_bounded_bypass(self):
        def task(name, size, exclusive=False):
            return {"resultPath": name, "memoryReservationBytes": size, "memoryExclusive": exclusive}

        queue = MemoryReservationScheduler([
            task("medium", 8), task("exclusive", 13, True),
            task("small1", 2), task("small2", 2), task("small3", 2),
        ], 13, max_bypasses=2)
        self.assertEqual(queue.admit(0)["resultPath"], "medium")
        self.assertEqual(queue.admit(1)["resultPath"], "small1")
        self.assertEqual(queue.admit(2)["resultPath"], "small2")
        self.assertEqual(queue.reserved_bytes(), 12)
        queue.release(1)
        # Oldest exclusive task has been bypassed twice: drain, rather than
        # keep starting the next small task and starve the large one.
        self.assertIsNone(queue.admit(1))
        queue.release(0)
        self.assertIsNone(queue.admit(0))
        queue.release(2)
        self.assertEqual(queue.admit(0)["resultPath"], "exclusive")
        self.assertEqual(queue.reserved_bytes(), 13)
        self.assertIsNone(queue.admit(1))
        queue.release(0)
        self.assertEqual(queue.admit(1)["resultPath"], "small3")
        self.assertEqual(queue.pending_count, 0)
        queue.release(1)

        growing = MemoryReservationScheduler([task("growing", 5), task("later", 4)], 13)
        growing.admit(0)
        self.assertIsNone(growing.admit(1, {0: 10}))
        self.assertEqual(growing.reserved_bytes({0: 10}), 10)
        self.assertEqual(growing.admit(1, {0: 8})["resultPath"], "later")
        self.assertLessEqual(growing.reserved_bytes({0: 8}), 13)
        with self.assertRaises(RuntimeError):
            growing.admit(1)
        with self.assertRaises(ValueError):
            MemoryReservationScheduler([task("oversized", 14)], 13)

        policy = json.loads(Path(__file__).with_name("memory-reservations.json").read_text())
        budget = policy["budgetBytes"]
        tasks = []
        for sample_key, reservation in policy["samples"].items():
            for variant in range(6):
                tasks.append({
                    "resultPath": f"{sample_key}/{variant}",
                    "memoryReservationBytes": reservation["reservationBytes"],
                    "memoryExclusive": reservation["exclusive"],
                })
        self.assertEqual(len(tasks), 252)
        matrix = MemoryReservationScheduler(tasks, budget)
        simulated_active = {}
        dispatched = set()
        clock = 0
        while matrix.pending_count or matrix.active:
            for slot in range(3):
                if slot in matrix.active:
                    continue
                selected = matrix.admit(slot)
                if selected:
                    self.assertNotIn(selected["resultPath"], dispatched)
                    dispatched.add(selected["resultPath"])
                    simulated_active[slot] = clock + 1 + len(dispatched) % 11
                    self.assertLessEqual(matrix.reserved_bytes(), budget)
                    if any(t["memoryExclusive"] for t in matrix.active.values()):
                        self.assertEqual(len(matrix.active), 1)
            self.assertTrue(simulated_active, "Reservation scheduler deadlocked")
            slot = min(simulated_active, key=simulated_active.get)
            clock = simulated_active.pop(slot)
            matrix.release(slot)
        self.assertEqual(len(dispatched), 252)

        large_budget = 48 * 1024**3
        large_tasks = []
        for sample_key, reservation in policy["samples"].items():
            for variant in range(6):
                estimate = reservation["estimatedPeakWithMarginBytes"]
                large_tasks.append({
                    "resultPath": f"{sample_key}/{variant}",
                    "memoryReservationBytes": min(estimate, large_budget),
                    "memoryExclusive": estimate > large_budget,
                    "heavy": reservation["exclusive"],
                })
        larger = MemoryReservationScheduler(large_tasks, large_budget)
        dispatched = set()
        simulated_active = {}
        clock = 0
        heavy_overlap_seen = False
        six_lanes_used = False
        while larger.pending_count or larger.active:
            for slot in range(6):
                if slot in larger.active:
                    continue
                selected = larger.admit(slot)
                if selected:
                    dispatched.add(selected["resultPath"])
                    simulated_active[slot] = clock + 1 + len(dispatched) % 11
                    self.assertLessEqual(larger.reserved_bytes(), large_budget)
                    heavy_overlap_seen |= sum(t["heavy"] for t in larger.active.values()) > 1
                    six_lanes_used |= len(larger.active) == 6
            self.assertTrue(simulated_active, "Larger-runner scheduler deadlocked")
            slot = min(simulated_active, key=simulated_active.get)
            clock = simulated_active.pop(slot)
            larger.release(slot)
        self.assertEqual(len(dispatched), 252)
        self.assertTrue(heavy_overlap_seen)
        self.assertTrue(six_lanes_used)


if __name__ == "__main__":
    unittest.main()
