import copy
import json
from pathlib import Path
import tempfile
import unittest

from arm_profiles import canonical_sha, load_config, planned_order, sanitized_child_environment, validate_cpu_ids
from configure_matrix import configure


class ArmProfileTests(unittest.TestCase):
    def test_exact_source_profiles_and_refusals(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "matrix.json"
            for profile in ["portfolio", "legalization"]:
                config = configure(profile, "a" * 40, "b" * 40, path, "c" * 40 if profile == "legalization" else None)
                self.assertEqual(len(config["arms"]), 5 if profile == "legalization" else 4)
                self.assertEqual(load_config(path), config)
                self.assertEqual(len(planned_order([(d, n) for d, count in [("srj18", 16), ("srj24", 26)] for n in range(1, count + 1)], [a["id"] for a in config["arms"]], config["orderSeed"])), 210 if profile == "legalization" else 168)
                for mutate in [lambda c: c["arms"].append(c["arms"][0]), lambda c: c["arms"][1].update(env={"HD_MODE": "x"}), lambda c: c.update(dependencyLockSha256="0" * 64), lambda c: c["arms"][1].update(commit="branch-name")]:
                    invalid = copy.deepcopy(config)
                    mutate(invalid)
                    path.write_text(json.dumps(invalid))
                    with self.assertRaises(ValueError):
                        load_config(path)

    def test_seeded_balanced_plan_and_environment(self):
        samples = [("srj18", n) for n in range(1, 17)]
        arms = ["control", "old", "eager", "lazy"]
        plan = planned_order(samples, arms, 91)
        self.assertEqual(plan, planned_order(samples, arms, 91))
        self.assertNotEqual(plan, planned_order(samples, arms, 92))
        self.assertEqual(len(set(plan)), 64)
        starts = [plan[i][0] for i in range(0, len(plan), 4)]
        self.assertEqual({arm: starts.count(arm) for arm in arms}, {arm: 4 for arm in arms})
        env, removed = sanitized_child_environment({"PATH": "/bin", "HD_PORTFOLIO_MODE": "lazy", "TSCIRCUIT_HD_MODE": "full", "BENCHMARK_ARGS_JSON": "[]", "GITHUB_RUN_ID": "123"})
        self.assertEqual(env, {"PATH": "/bin", "GITHUB_RUN_ID": "123"})
        self.assertEqual(len(removed), 3)
        with self.assertRaises(ValueError):
            sanitized_child_environment({"BUN_OPTIONS": "--preload override.ts"})
        for cpus, concurrency in [([0, 0], 2), ([0, 1], 3), (list(range(7)), 7)]:
            with self.assertRaises(ValueError):
                validate_cpu_ids(cpus, concurrency, set(range(8)))
        validate_cpu_ids(list(range(6)), 6, set(range(8)))
        self.assertNotEqual(canonical_sha({"mode": "eager"}), canonical_sha({"mode": "lazy"}))


if __name__ == "__main__":
    unittest.main()
