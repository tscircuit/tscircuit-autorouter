import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("joint DRC keeps length-matched preload geometry immutable near a new crossing", (): void => {
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "matched_trace",
    connection_name: "matched",
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "top" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [],
    traces: [fixedTrace],
    connections: [{
      name: "crossing",
      pointsToConnect: [
        { x: 0, y: -2, layer: "top" },
        { x: 0, y: 2, layer: "top" },
      ],
    }],
  }
  const route: HighDensityRoute = {
    connectionName: "crossing",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }],
    vias: [],
  }
  const params: ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] = {
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: [route],
    updatedPreloadedTraces: [fixedTrace],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: [],
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  }
  const unrestricted = new Pipeline9JointDrcRepairSolver(params)
  expect(unrestricted.movablePreloadedSections.length).toBeGreaterThan(0)
  const solver = new Pipeline9JointDrcRepairSolver({
    ...params,
    immutablePreloadedTraceIds: new Set([fixedTrace.pcb_trace_id]),
  })
  expect(solver.movablePreloadedSections).toEqual([])
  expect(solver.fixedPreloadedObstacleRoutes.length).toBeGreaterThan(0)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getUpdatedPreloadedTraces()).toEqual([fixedTrace])
  expect(solver.getMutatedPreloadedTraces()).toEqual([])
})
