import sys
import unittest
from unittest.mock import patch

from cpu_resources import get_cpu_capacity, validate_cpu_request
from run_matrix import parse


class CpuResourcesTest(unittest.TestCase):
    def test_observed_limits_parser_and_six_lane_requests(self):
        local = get_cpu_capacity(list(range(5)), "400000 100000")
        self.assertEqual(local["effectiveCpuCount"], 4)
        self.assertEqual(local["quotaCores"], 4)
        self.assertEqual(validate_cpu_request(4, local), 4)
        with self.assertRaisesRegex(ValueError, "exceeds observed CPU capacity 4"):
            validate_cpu_request(6, local)
        large = get_cpu_capacity(list(range(32)), "max 100000")
        self.assertEqual(large["quotaObservation"], "unlimited")
        self.assertIsNone(large["quotaCores"])
        self.assertEqual(validate_cpu_request(6, large), 6)
        limited_affinity = get_cpu_capacity([2, 4, 6], "3200000 100000")
        self.assertEqual(limited_affinity["effectiveCpuCount"], 3)
        with self.assertRaises(ValueError):
            validate_cpu_request(6, limited_affinity)
        fractional = get_cpu_capacity(list(range(8)), "350000 100000")
        self.assertEqual(fractional["effectiveCpuCount"], 3)
        with self.assertRaises(ValueError):
            validate_cpu_request(4, fractional)
        unavailable = get_cpu_capacity(list(range(8)), None)
        self.assertEqual(unavailable["quotaObservation"], "unavailable")
        self.assertIsNone(unavailable["quotaCores"])
        for bad in ["0 100000", "max 0", "invalid", "-1 100000"]:
            with self.assertRaises(ValueError):
                get_cpu_capacity(list(range(8)), bad)
        with patch.object(sys, "argv", ["run_matrix.py", "--out", "/tmp/not-executed", "--arms-config", "/tmp/not-read.json", "--concurrency", "6"]):
            self.assertEqual(parse().concurrency, 6)
        with patch.object(sys, "argv", ["run_matrix.py", "--out", "/tmp/not-executed", "--arms-config", "/tmp/not-read.json"]):
            self.assertEqual(parse().concurrency, 3)


if __name__ == "__main__":
    unittest.main()
