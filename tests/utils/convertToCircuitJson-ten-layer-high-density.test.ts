import { expect, test } from "bun:test";
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson";
import type { SimpleRouteJson } from "lib/types";
import type { HighDensityRoute } from "lib/types/high-density-types";
import type { LayerName } from "lib/utils/mapZToLayerName";

test("converts ten-layer high-density routes and vias to circuit json", () => {
  const srj: SimpleRouteJson = {
    layerCount: 10,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -2, maxX: 3, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "ten-layer-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "inner8" },
          { x: 2, y: 0, layer: "bottom" },
        ],
      },
    ],
  };
  const routes: HighDensityRoute[] = [
    {
      connectionName: "ten-layer-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 8 },
        { x: 1, y: 0, z: 8 },
        { x: 1, y: 0, z: 9 },
        { x: 2, y: 0, z: 9 },
      ],
      vias: [{ x: 1, y: 0 }],
    },
  ];

  const circuitJson = convertToCircuitJson(srj, routes);
  const trace = circuitJson.find((element) => element.type === "pcb_trace");
  const via = circuitJson.find((element) => element.type === "pcb_via");

  expect(trace?.type).toBe("pcb_trace");
  expect(
    trace?.type === "pcb_trace" &&
      trace.route.some(
        (routePoint) =>
          routePoint.route_type === "wire" &&
          (routePoint.layer as LayerName) === "inner8",
      ),
  ).toBe(true);
  expect(via?.type).toBe("pcb_via");
  expect(via?.type === "pcb_via" && (via.layers as LayerName[])).toEqual([
    "inner8",
    "bottom",
  ]);
});
