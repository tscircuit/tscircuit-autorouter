import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/apply-fixed-route-replacements-to-preloaded-traces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import {
  getMaterializedPreloadedSectionHdRoutes,
  removeChangedSectionsFromFixedHdRoutes,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materialize-hypergraph-preloaded-trace-sections"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimplifiedPcbTrace } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"

test("Pipeline9 splices a routed hypergraph section into its original trace ID", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "pcb_trace_preloaded",
    connection_name: "preloaded-connection",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 10, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["preloaded-connection", "preloaded-root"]])
  const originalFixedRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    0,
    2,
    0.6,
    connMap,
  )
  const section = {
    connectionName: '__tscircuit_preloaded_trace__:["pcb_trace_preloaded",0]',
    traceId: trace.pcb_trace_id,
    startRoutePosition: 0.25,
    endRoutePosition: 0.75,
    connection: {
      name: '__tscircuit_preloaded_trace__:["pcb_trace_preloaded",0]',
      __rootConnectionNames: ["preloaded-root"],
      pointsToConnect: [
        { x: 2.5, y: 0, layer: "top" },
        { x: 7.5, y: 0, layer: "top" },
      ],
    },
  } as ChangedPreloadedTraceSection
  const fixedRoutes = removeChangedSectionsFromFixedHdRoutes({
    traces: [trace],
    fixedHdRoutes: originalFixedRoutes,
    sections: [section],
  })
  const movedStart: PortPoint = {
    connectionName: section.connectionName,
    rootConnectionName: "preloaded-root",
    portPointId: "moved-start",
    nextPortPointId: "moved-end",
    x: 2.5,
    y: 1,
    z: 0,
  }
  const movedEnd: PortPoint = {
    connectionName: section.connectionName,
    rootConnectionName: "preloaded-root",
    portPointId: "moved-end",
    prevPortPointId: "moved-start",
    x: 7.5,
    y: 1,
    z: 0,
  }
  const highDensitySolver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "changed-preload-node",
        center: { x: 5, y: 1 },
        width: 5,
        height: 2,
        availableZ: [0],
        portPoints: [movedStart, movedEnd],
        portPointsInPairs: [[movedStart, movedEnd]],
      },
    ],
    fixedHdRoutes: fixedRoutes,
    connMap,
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.6,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 0.1,
    enableRegionalFallback: false,
  })
  highDensitySolver.solve()
  expect(highDensitySolver.failed).toBeFalse()

  const stitchSolver = new MultipleHighDensityRouteStitchSolver3({
    connections: [section.connection],
    hdRoutes: highDensitySolver.routes,
    layerCount: 2,
    defaultViaDiameter: 0.6,
  })
  stitchSolver.solve()
  expect(stitchSolver.failed).toBeFalse()
  const disconnectedIsland = {
    ...stitchSolver.mergedHdRoutes[0]!,
    route: [
      { x: 4, y: 4, z: 0 },
      { x: 6, y: 4, z: 0 },
    ],
  }
  const materializedRoutes = getMaterializedPreloadedSectionHdRoutes({
    traces: [trace],
    sections: [section],
    stitchedHdRoutes: [...stitchSolver.mergedHdRoutes, disconnectedIsland],
    layerCount: 2,
  })

  expect(fixedRoutes.map((route) => route.route)).toEqual([
    [
      { x: 0, y: 0, z: 0 },
      { x: 2.5, y: 0, z: 0 },
    ],
    [
      { x: 7.5, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
  ])

  const { updatedPreloadedTraces, mutatedPreloadedTraces } =
    applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: [trace],
      originalFixedRoutes,
      updatedFixedRoutes: [...fixedRoutes, ...materializedRoutes],
      replacedConnectionNames: new Set([
        originalFixedRoutes[0]!.connectionName,
      ]),
      layerCount: 2,
      defaultViaHoleDiameter: 0.3,
      obstacles: [],
      connMap,
    })

  expect(mutatedPreloadedTraces).toHaveLength(1)
  expect(updatedPreloadedTraces[0]).toMatchObject({
    pcb_trace_id: "pcb_trace_preloaded",
    __replaces_pcb_trace_id: "pcb_trace_preloaded",
  })
  expect(
    updatedPreloadedTraces[0]!.route.some(
      (routePoint) => routePoint.route_type === "wire" && routePoint.y === 1,
    ),
  ).toBeTrue()
  expect(
    updatedPreloadedTraces[0]!.route.every(
      (routePoint) =>
        routePoint.route_type !== "wire" || routePoint.width === 0.1,
    ),
  ).toBeTrue()
})
