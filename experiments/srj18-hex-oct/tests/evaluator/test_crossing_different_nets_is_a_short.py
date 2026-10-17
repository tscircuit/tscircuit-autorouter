import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from evaluate import evaluate
from helpers import fixture, trace


class EvaluationTest(unittest.TestCase):
    def test_crossing_different_nets_is_a_short(self):
        srj=fixture()
        srj['connections'].append({'name':'b','pointsToConnect':[{'x':5,'y':-1,'layer':'top'},{'x':5,'y':1,'layer':'top'}]})
        result=evaluate(srj,{'traces':[trace('a',[(0,0),(10,0)]),trace('b',[(5,-1),(5,1)])]})
        self.assertEqual(result['physicallyConnected'],2)
        self.assertEqual(result['connectedWithoutShort'],0)
        self.assertGreater(result['newShortPairs'],0)
