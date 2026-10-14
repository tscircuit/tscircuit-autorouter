import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from evaluate import evaluate
from helpers import fixture, trace


class EvaluationTest(unittest.TestCase):
    def test_plated_pad_layer_transition_connects_physically(self):
        srj=fixture()
        srj['connections'][0]['pointsToConnect'][1]['layer']='bottom'
        srj['obstacles']=[{'type':'oval','center':{'x':5,'y':0},'width':.4,'height':.4,'layers':['top','bottom'],'connectedTo':['a']}]
        result=evaluate(srj,{'traces':[trace('a',[(0,0),(5,0)]),trace('a',[(5,0),(10,0)],'bottom')]})
        self.assertEqual(result['physicallyConnected'],1)
