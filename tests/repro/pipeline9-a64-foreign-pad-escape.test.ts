import { checkViaPadClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/assets/a64-foreign-pad-escape.json"

test.failing("Pipeline9 repairs the A64 escape beside a foreign pad without PCB ids", async (): Promise<void> => {
  const srj = structuredClone(fixture.srj) as SimpleRouteJson
  const initialTrace = fixture.trace as SimplifiedPcbTrace
  const hdRoute: HighDensityRoute = {
    connectionName: initialTrace.connection_name,
    rootConnectionName: initialTrace.connection_name,
    traceThickness: srj.minTraceWidth,
    viaDiameter: 0.327,
    route: initialTrace.route.flatMap((point) =>
      point.route_type === "wire"
        ? [{ x: point.x, y: point.y, z: point.layer === "top" ? 0 : 1 }]
        : [],
    ),
    vias: [{ x: 132.404, y: -85.4 }],
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: [hdRoute],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.327,
    defaultViaHoleDiameter: 0.2,
    effort: 1,
    colorMap: {},
  })
  solver.solve()
  const routedTraces: SimplifiedPcbTrace[] = solver.getOutput().map((route) => ({
    type: "pcb_trace",
    pcb_trace_id: "a64-dq4-repaired",
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, srj.layerCount, {
      defaultViaHoleDiameter: 0.2,
    }),
  }))
  // Supplying explicit PCB identities only to the independent reference makes
  // the original physical pads visible to the pre-fix checker as well.
  const referenceSrj: SimpleRouteJson = {
    ...srj,
    connections: srj.connections.map((connection) => ({
      ...connection,
      pointsToConnect: connection.pointsToConnect.map((point) => ({
        ...point,
        pcb_port_id: point.pointId,
      })),
    })),
    obstacles: srj.obstacles.map((obstacle) => ({
      ...obstacle,
      circuitJsonMetadata: {
        ...obstacle.circuitJsonMetadata,
        pcb_smtpad_id: obstacle.obstacleId,
        ...(obstacle.obstacleId === "U2.E3" ? { pcb_port_id: "U2.E3" } : {}),
      },
    })),
  }
  const reference = evaluateRelaxedDrc({
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces,
    drcOptions: { includeTraceContinuity: false },
  })
  await expect(getBugReportSnapshotSvg({
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces,
    drcOptions: { includeTraceContinuity: false },
  })).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
  expect(reference.errors).toHaveLength(0)
  expect(checkViaPadClearance(reference.circuitJson, { minClearance: 0.1 })).toHaveLength(0)
  expect(srj).toEqual(fixture.srj)
})
