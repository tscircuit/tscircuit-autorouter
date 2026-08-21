import { expect, test } from "bun:test";
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver";
import type { SimpleRouteJson } from "lib/types";
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json";

test("the point-pair MST adapts canonical initially connected groups", () => {
  const srj = {
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "net1",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "port1" },
          { x: 1, y: 0, layer: "top", pointId: "port2" },
          { x: 2, y: 0, layer: "top", pointId: "port3" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "trace1",
        connection_name: "net1",
        connectsTo: ["port1", "port2"],
        route: [],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "trace2",
        connection_name: "net1",
        connectsTo: ["port2", "port3"],
        route: [],
      },
    ],
  } satisfies SimpleRouteJson;

  const solver = new NetToPointPairsSolver(
    structuredClone(srj),
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  );
  solver.solve();

  expect(solver.newConnections).toHaveLength(0);
});
