import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("hd_summary", Path(__file__).with_name("summarize.py"))
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


class SummaryTest(unittest.TestCase):
    def test_quality_penalties_and_same_input_hd_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def record(variant, sample, elapsed, solved, clean, hd_ms=None,
                       phase=None, hd_hash="same", timeout=False, vias=0):
                stages = []
                if hd_ms is not None:
                    stages.append({"stageName": "highDensityRouteSolver", "elapsedTimeMs": hd_ms})
                result = {
                    "elapsedTimeMs": elapsed,
                    "didSolve": solved,
                    "didTimeout": timeout,
                    "relaxedDrcPassed": clean,
                    "viaCount": vias,
                    "wireLengthMm": vias * 10,
                    "stageTiming": {"status": "complete" if solved else "partial", "stages": stages},
                    "errorPhaseName": phase,
                    "error": "same upstream failure" if phase == "portPointPathingSolver" else None,
                    "highDensity": {"solved": hd_ms is not None and phase != "highDensityRouteSolver", "diagnostics": {"testCounter": sample}},
                    "hdInput": {"sha256": hd_hash} if hd_ms is not None else None,
                }
                report = {
                    "variant": variant, "dataset": "srj18", "sampleNumber": sample,
                    "commit": "baseline" if variant == "control" else "experiment",
                    "timeoutMs": 360_000, "result": result,
                }
                path = root / "full" / variant / f"srj18-{sample:03d}.json"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(report))

            record("control", 1, 10_000, True, True, 5_000, vias=5)
            record("kernel", 1, 8_000, True, True, 4_000, vias=6)
            record("control", 2, 20_000, True, True, 7_000, vias=100)
            record("kernel", 2, 3_000, False, False, 3_000, phase="jointDrcRepairSolver", vias=0)
            record("control", 3, 1_000, False, False, phase="portPointPathingSolver")
            record("kernel", 3, 2_000, False, False, phase="portPointPathingSolver")
            record("control", 4, 30_000, True, True, 5_000, hd_hash="base input", vias=7)
            record("kernel", 4, 15_000, True, True, 1_000, hd_hash="different input", vias=8)
            record("control", 5, 360_000, False, False, 355_000, phase="highDensityRouteSolver", timeout=True)
            record("kernel", 5, 360_000, False, False, 355_000, phase="highDensityRouteSolver", timeout=True)

            report = summary.build(root, "full")
            row = next(r for r in report["rows"] if r["variant"] == "kernel")
            self.assertEqual(row["count"], 5)
            self.assertEqual(row["clean"], 2)
            self.assertEqual(row["timeouts"], 1)
            self.assertEqual(row["otherFailures"], 2)
            self.assertEqual(row["failurePenalizedSecondsSum"], 1103)
            self.assertEqual(row["pairedCleanCount"], 2)
            self.assertEqual(row["pairedCleanViaBefore"], 12)
            self.assertEqual(row["pairedCleanViaAfter"], 14)
            self.assertEqual(row["pairedHdCompletedCount"], 2)
            self.assertEqual(row["pairedHdBeforeSeconds"], 12)
            self.assertEqual(row["pairedHdAfterSeconds"], 7)
            self.assertEqual(row["sameUpstreamFailureCount"], 1)
            self.assertEqual(report["numericDiagnosticTotals"]["srj18/kernel"]["testCounter"], 15)


if __name__ == "__main__":
    unittest.main()
