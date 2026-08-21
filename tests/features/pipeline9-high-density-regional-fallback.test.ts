import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-fixed-route-replacements-to-preloaded-traces";
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes";
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver";
import type { SimplifiedPcbTrace } from "lib/types";
import type { NodeWithPortPoints } from "lib/types/high-density-types";

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "cmn_4",
  center: { x: 3.4875, y: -5.2375 },
  width: 5.475,
  height: 9.525,
  availableZ: [0, 1],
  portPoints: [
    {
      x: 0.75,
      y: -6,
      z: 0,
      connectionName: "source_net_0_mst0",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 0.9875,
      y: -0.475,
      z: 0,
      connectionName: "source_net_0_mst0",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 0.75,
      y: -1.90875,
      z: 0,
      connectionName: "source_net_3_mst1",
      rootConnectionName: "connectivity_net0",
    },
    {
      x: 5,
      y: -0.475,
      z: 0,
      connectionName: "source_net_3_mst1",
      rootConnectionName: "connectivity_net0",
    },
    {
      x: 2.5,
      y: -0.475,
      z: 0,
      connectionName: "source_net_0_mst2",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 3.9625,
      y: -0.475,
      z: 1,
      connectionName: "source_net_0_mst2",
      rootConnectionName: "connectivity_net3",
    },
    {
      x: 0.75,
      y: -4.1675,
      z: 0,
      connectionName: "source_net_2_mst2",
      rootConnectionName: "connectivity_net1",
    },
    {
      x: 6.225,
      y: -5.2375,
      z: 0,
      connectionName: "source_net_2_mst2",
      rootConnectionName: "connectivity_net1",
    },
  ],
};

const fixedRoutes: PreloadedHighDensityRoute[] = [
  {
    connectionName: "source_net_0_fixed_0_0",
    rootConnectionName: "connectivity_net3",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -7.27, z: 0 },
      { x: 0.9539681227515293, y: -6.31603187724847, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
  },
  {
    connectionName: "source_net_0_fixed_0_1",
    rootConnectionName: "connectivity_net3",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.9539681227515293, y: -6.31603187724847, z: 0 },
      { x: 0.9539681227515293, y: -0.19605561044583464, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 1,
  },
  {
    connectionName: "source_net_0_fixed_0_2",
    rootConnectionName: "connectivity_net3",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0.9539681227515293, y: -0.19605561044583464, z: 0 },
      { x: 0.9539681227515293, y: -0.12896812275152936, z: 0 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 2,
  },
];

const preloadedTrace: SimplifiedPcbTrace = {
  type: "pcb_trace",
  pcb_trace_id: "source_net_0_mst0_0",
  connection_name: "source_net_0",
  route: fixedRoutes.flatMap((fixedRoute, routeIndex) =>
    fixedRoute.route.slice(routeIndex === 0 ? 0 : 1).map((point) => ({
      route_type: "wire" as const,
      x: point.x,
      y: point.y,
      width: fixedRoute.traceThickness,
      layer: "top",
    })),
  ),
};

test("Pipeline9 falls back to regional rerouting and splices fixed traces", () => {
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: fixedRoutes,
    connMap: new ConnectivityMap({
      connectivity_net0: ["source_net_3_mst1"],
      connectivity_net1: ["source_net_2_mst2"],
      connectivity_net3: [
        "source_net_0_mst0",
        "source_net_0_mst2",
        ...fixedRoutes.map((route) => route.connectionName),
      ],
    }),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  });

  solver.solve();

  expect(solver.solved).toBeTrue();
  expect(solver.failed).toBeFalse();
  expect(solver.failedSolvers).toHaveLength(1);
  expect(solver.stats).toMatchObject({
    fallbackNodeCount: 1,
    reroutedFixedRouteCount: 2,
    reroutedFixedRouteSectionCount: 1,
  });
  expect(solver.routes).toHaveLength(4);
  expect([...solver.fixedRouteReplacements.keys()]).toEqual([
    "source_net_0_fixed_0_0",
  ]);

  const updatedFixedRoutes = solver.getUpdatedFixedHdRoutes();
  expect(updatedFixedRoutes).toHaveLength(2);
  expect(updatedFixedRoutes[0]!.route[0]).toEqual(fixedRoutes[0]!.route[0]);
  expect(updatedFixedRoutes[0]!.route.at(-1)).toEqual(
    fixedRoutes[1]!.route.at(-1),
  );
  expect(updatedFixedRoutes[1]).toBe(fixedRoutes[2]);

  const { updatedPreloadedTraces, mutatedPreloadedTraces } =
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: [preloadedTrace],
      originalFixedRoutes: fixedRoutes,
      updatedFixedRoutes,
      replacedConnectionNames: new Set(solver.fixedRouteReplacements.keys()),
      layerCount: 2,
      defaultViaHoleDiameter: 0.15,
      obstacles: [],
      connMap: solver.connMap,
    });
  expect(mutatedPreloadedTraces).toHaveLength(1);
  expect(updatedPreloadedTraces[0]!.pcb_trace_id).toBe(
    preloadedTrace.pcb_trace_id,
  );
  expect(updatedPreloadedTraces[0]!.route[0]).toMatchObject(
    preloadedTrace.route[0]!,
  );
  expect(updatedPreloadedTraces[0]!.route.at(-1)).toMatchObject(
    preloadedTrace.route.at(-1)!,
  );
  expect(updatedPreloadedTraces[0]!.route.length).toBeGreaterThan(
    preloadedTrace.route.length,
  );
});
