import sys
import unittest
from pathlib import Path

sys.path.insert(0, "/tmp/full-board-python")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from kicad_source import parse
from plane_intent import extract_plane_intent
from shapely.geometry import Polygon
from shapely.ops import unary_union


class PlaneIntentTest(unittest.TestCase):
    def test_retains_split_plane_constraints_without_saved_fills(self):
        tree = parse('''(kicad_pcb
          (zone (net 1) (layer In1.Cu) (connect_pads (clearance 0.2))
            (polygon (pts (xy 0 0) (xy 12 0) (xy 12 10) (xy 0 10)))
            (filled_polygon (pts (xy 50 50) (xy 60 50) (xy 60 60))))
          (zone (net 2) (layer In1.Cu) (priority 1) (connect_pads yes (clearance 0.2))
            (polygon (pts (xy 4 3) (xy 8 3) (xy 8 7) (xy 4 7))))
          (zone (net 0) (layer In1.Cu) (keepout (copperpour not_allowed))
            (polygon (pts (xy 1 1) (xy 2 1) (xy 2 2) (xy 1 2))))
          (zone (net 1) (layer F.Cu) (attr (teardrop (type track_end)))
            (polygon (pts (xy 0 0) (xy 1 0) (xy 0 1)))))''')
        result = extract_plane_intent(tree, {"1": "GND", "2": "VCC"},
                                      {"F.Cu": "top", "In1.Cu": "inner1"},
                                      [(0,0),(12,0),(12,10),(0,10)], (6,5), 0.2)
        self.assertFalse(result["savedCopperImported"])
        self.assertEqual(result["skippedTeardrops"], 1)
        self.assertEqual(result["sourceKeepouts"], 1)
        self.assertEqual(len(result["zones"]), 2)
        ground, power = result["zones"]
        def polygon_union(zone):
            return unary_union([Polygon([(p["x"],p["y"]) for p in outline]) for outline in zone["outlines"]])
        ground_shape, power_shape = polygon_union(ground), polygon_union(power)
        self.assertAlmostEqual(power_shape.area, 16)
        self.assertGreater(ground_shape.distance(power_shape), 0.199999)
        self.assertEqual(ground_shape.intersection(Polygon([(-5,4),(-4,4),(-4,3),(-5,3)])).area, 0)
        self.assertEqual(ground_shape.bounds, (-6.0,-5.0,6.0,5.0))
        self.assertTrue(all(zone["unbroken"] for zone in result["zones"]))
        self.assertLess(ground_shape.area, 103)


if __name__ == "__main__":
    unittest.main()
