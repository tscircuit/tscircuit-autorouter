"""Conservative sample admission; reservations never cap a solver process."""
from dataclasses import dataclass


@dataclass
class WaitingTask:
    task: dict
    bypasses: int = 0


class MemoryReservationScheduler:
    def __init__(self, tasks, budget_bytes, max_bypasses=8):
        if not isinstance(budget_bytes, int) or budget_bytes <= 0:
            raise ValueError("Admission memory budget must be a positive integer")
        if not isinstance(max_bypasses, int) or max_bypasses < 0:
            raise ValueError("Maximum queue bypasses must be a nonnegative integer")
        self.budget_bytes = budget_bytes
        self.max_bypasses = max_bypasses
        self.waiting = [WaitingTask(task) for task in tasks]
        self.active = {}
        for entry in self.waiting:
            size = entry.task.get("memoryReservationBytes")
            if not isinstance(size, int) or size <= 0 or size > budget_bytes:
                raise ValueError(f"Invalid reservation {size} for {entry.task.get('resultPath')}")

    @property
    def pending_count(self):
        return len(self.waiting)

    def reserved_bytes(self, observed_rss=None):
        observed_rss = observed_rss or {}
        # A growing process can exceed its estimate. Count its observed RSS
        # instead, preserving the original reservation until it actually exits.
        return sum(max(task["memoryReservationBytes"], observed_rss.get(slot, 0))
                   for slot, task in self.active.items())

    def admit(self, slot, observed_rss=None):
        if slot in self.active:
            raise RuntimeError(f"Worker slot {slot} already owns a reservation")
        if not self.waiting:
            return None
        if any(task.get("memoryExclusive") for task in self.active.values()):
            return None
        remaining = self.budget_bytes - self.reserved_bytes(observed_rss)
        drain_for_oldest = self.waiting[0].bypasses >= self.max_bypasses
        for index, entry in enumerate(self.waiting):
            if drain_for_oldest and index > 0:
                # Bounded bypasses keep an exclusive/large oldest task from
                # waiting behind an endless stream of newly admitted small jobs.
                return None
            task = entry.task
            if task["memoryReservationBytes"] > remaining:
                continue
            if task.get("memoryExclusive") and self.active:
                continue
            for bypassed in self.waiting[:index]:
                bypassed.bypasses += 1
            self.waiting.pop(index)
            # Reserve synchronously, before process creation yields to another
            # lane, so two simultaneous starts cannot oversubscribe the budget.
            self.active[slot] = task
            return task
        return None

    def release(self, slot):
        if slot not in self.active:
            raise RuntimeError(f"Worker slot {slot} has no reservation to release")
        del self.active[slot]
