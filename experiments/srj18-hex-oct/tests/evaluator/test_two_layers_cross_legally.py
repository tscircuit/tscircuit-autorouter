import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from evaluate import evaluate
from helpers import fixture, trace


class EvaluationTest(unittest.TestCase):
    def test_two_layers_cross_legally(self):
        srj=fixture()
        srj['connections'].append({'name':'b','pointsToConnect':[{'x':5,'y':-1,'layer':'bottom'},{'x':5,'y':1,'layer':'bottom'}]})
        result=evaluate(srj,{'traces':[trace('a',[(0,0),(10,0)]),trace('b',[(5,-1),(5,1)],'bottom')]})
        self.assertEqual(result['physicallyConnected'],2)
        self.assertTrue(result['drcPass'])
