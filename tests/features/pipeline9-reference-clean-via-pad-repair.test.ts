import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-joint-drc-repair-solver"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 repairs indexed via-pad residue when reference DRC is clean", () => {
  const connection: SimpleRouteConnection = {
    name: "route",
    pointsToConnect: [
      {
        x: -6,
        y: 0,
        layer: "top",
        pcb_port_id: "start_port",
      },
      {
        x: 6,
        y: 0,
        layer: "bottom",
        pcb_port_id: "end_port",
      },
    ],
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: -6, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["route", "start_port"],
    },
    {
      type: "rect",
      center: { x: 6, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["bottom"],
      connectedTo: ["route", "end_port"],
    },
    {
      obstacleId: "foreign_inner_pad",
      type: "rect",
      center: { x: 0, y: 0.3 },
      width: 0.2,
      height: 0.2,
      layers: ["bottom"],
      connectedTo: ["foreign_inner_pad", "foreign_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "foreign_inner_pad" },
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -7, minY: -1, maxX: 7, maxY: 1 },
    obstacles,
    connections: [connection],
  }
  const route: HighDensityRoute = {
    connectionName: "route",
    rootConnectionName: "route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -6, y: 0, z: 0, pcb_port_id: "start_port" },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 6, y: 0, z: 1, pcb_port_id: "end_port" },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: [connection],
    newHdRoutes: [route],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: { route: "red" },
  })
  const indexedDrcEvaluator = ((input: {
    hdRoutes?: HighDensityRoute[]
    routes?: HighDensityRoute[]
  }) => {
    const evaluatedRoute = (input.hdRoutes ?? input.routes ?? [])[0]
    const via = evaluatedRoute?.vias[0]
    const distanceX = via ? Math.max(Math.abs(via.x) - 0.1, 0) : 0
    const distanceY = via ? Math.max(Math.abs(via.y - 0.3) - 0.1, 0) : 0
    const actualClearance = Math.hypot(distanceX, distanceY) - 0.15
    const errors =
      via && actualClearance < 0.1 - 1e-9
        ? [
            {
              type: "pcb_pad_pad_clearance_error",
              pcb_trace_id: "route_0",
              pcb_via_ids: ["via_0"],
              pcb_pad_ids: ["via_0", "foreign_inner_pad"],
              actual_clearance: actualClearance,
              minimum_clearance: 0.1,
              center: { x: via.x, y: via.y },
            },
          ]
        : []
    return { errors, errorsWithCenters: errors }
  }) as unknown as DrcEvaluator
  const referenceDrcEvaluator = (() => ({
    errors: [],
    errorsWithCenters: [],
  })) as DrcEvaluator
  const mutableSolver = solver as unknown as {
    solved: boolean
    drcEvaluator: DrcEvaluator
    cachedReferenceDrcEvaluator: DrcEvaluator
    exactRepairSolver: {
      step: () => void
      progress: number
      failed: boolean
      error: null
      solved: boolean
      stats: Record<string, number>
      getOutput: () => HighDensityRoute[]
    }
  }
  mutableSolver.solved = false
  mutableSolver.drcEvaluator = indexedDrcEvaluator
  mutableSolver.cachedReferenceDrcEvaluator = referenceDrcEvaluator
  mutableSolver.exactRepairSolver = {
    step: () => {},
    progress: 1,
    failed: false,
    error: null,
    solved: true,
    stats: { finalDrcIssueCount: 1 },
    getOutput: () => [route],
  }

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.postExactReferenceDrcIssueCount).toBe(0)
  expect(solver.stats.regionalB01RepairAttempted).toBeFalse()
  expect(solver.stats.terminalEscapeCandidateCount).toBe(0)
  expect(solver.stats.viaPadClearanceRepairAcceptedCount).toBe(1)
  expect(solver.stats.viaPadClearanceRemainingIssueCount).toBe(0)
  const repairedVia = solver.getOutput()[0]!.vias[0]!
  const repairedDistanceX = Math.max(Math.abs(repairedVia.x) - 0.1, 0)
  const repairedDistanceY = Math.max(Math.abs(repairedVia.y - 0.3) - 0.1, 0)
  expect(
    Math.hypot(repairedDistanceX, repairedDistanceY) - 0.15,
  ).toBeGreaterThanOrEqual(0.1 - 1e-9)
})
