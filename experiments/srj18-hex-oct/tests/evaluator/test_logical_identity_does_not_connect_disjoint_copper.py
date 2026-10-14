import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from evaluate import evaluate
from helpers import fixture, trace


class EvaluationTest(unittest.TestCase):
    def test_logical_identity_does_not_connect_disjoint_copper(self):
        srj=fixture()
        result=evaluate(srj,{'traces':[trace('a',[(0,0),(4,0)]),trace('a',[(6,0),(10,0)])]})
        self.assertEqual(result['physicallyConnected'],0)
