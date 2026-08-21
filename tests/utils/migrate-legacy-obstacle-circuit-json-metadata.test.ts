import { expect, test } from "bun:test";
import { migrateLegacyObstacleCircuitJsonMetadata } from "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata";
import type { SimpleRouteJson } from "lib/types";

test("migrates legacy obstacle ordering without parsing opaque IDs", () => {
  const legacySrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -0.5, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: [
          "opaque-smt-element",
          "opaque-net",
          "opaque-smt-element",
          "opaque-smt-port",
        ],
      },
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0.5, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: [
          "opaque-through-element",
          "opaque-net",
          "opaque-through-element",
          "opaque-through-port",
        ],
      },
    ],
  };

  const migratedSrj = migrateLegacyObstacleCircuitJsonMetadata(legacySrj);

  expect(legacySrj.obstacles[0].circuitJsonMetadata).toBeUndefined();
  expect(migratedSrj.obstacles[0].circuitJsonMetadata).toEqual({
    pcb_smtpad_id: "opaque-smt-element",
    pcb_port_id: "opaque-smt-port",
  });
  expect(migratedSrj.obstacles[1].circuitJsonMetadata).toEqual({
    pcb_plated_hole_id: "opaque-through-element",
    pcb_port_id: "opaque-through-port",
  });
});
