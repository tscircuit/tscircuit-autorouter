import unittest

from run_matrix import timeout_result, retain_observed_metadata


class TimeoutSourceProblemTest(unittest.TestCase):
    def test_pre_solve_identity_survives_without_a_fresh_heartbeat(self):
        source = {"srjSha256": "a" * 64, "scenarioSha256": "b" * 64, "dataset": "srj24", "sampleNumber": 1}
        stale_progress = {"phaseName": "highDensityRouteSolver", "elapsedTimeMs": 1000, "stageTiming": {"status": "partial", "stages": [{"stageName": "highDensityRouteSolver", "elapsedTimeMs": 1000}]}}
        report = timeout_result({"timeoutMs": 360000}, stale_progress, 360000, "timeout", source)
        self.assertEqual(report["result"]["sourceProblem"], source)
        self.assertTrue(report["result"]["didTimeout"])
        self.assertEqual(report["result"]["stageTiming"]["status"], "partial")
        self.assertEqual(report["result"]["stageTiming"]["stages"][0]["elapsedTimeMs"], 360000)
        self.assertNotIn("sourceProblem", stale_progress)

    def test_worker_exception_retains_observed_hd_without_inventing_completion(self):
        report = {"result": {"didSolve": False, "errorPhaseName": "jointDrcSolver"}}
        progress = {"phaseName": "highDensityRouteSolver", "elapsedTimeMs": 1000,
                    "stageTiming": {"status": "complete", "stages": [{"stageName": "highDensityRouteSolver", "elapsedTimeMs": 1000}]},
                    "highDensity": {"iterations": 100}}
        source, hd = {"srjSha256": "a" * 64}, {"sha256": "b" * 64}
        retained = retain_observed_metadata(report, progress, hd, source)
        self.assertFalse(retained["result"]["didSolve"])
        self.assertNotIn("solved", retained["result"]["highDensity"])
        self.assertEqual(retained["result"]["stageTiming"]["status"], "partial")
        self.assertEqual(retained["result"]["sourceProblem"], source)
        self.assertEqual(retained["result"]["hdInput"], hd)
        self.assertEqual(set(retained["observedMetadataRetention"]["fields"]), {"hdInput", "sourceProblem", "stageTiming", "highDensity"})
        self.assertEqual(progress["stageTiming"]["status"], "complete")


if __name__ == "__main__":
    unittest.main()
