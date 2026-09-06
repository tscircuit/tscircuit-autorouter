import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { getDrcScaledMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

test("Pipeline9 bounds repeated severity-only force repairs and retains the accepted incumbent", (): void => {
  const effort = 1
  const maxNodePasses = getDrcScaledMaxIterations(1, effort)
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "node-a",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -50, y: 0, z: 0, pcb_port_id: "A-start" },
      { x: 0, y: 0, z: 0 },
      { x: 50, y: 0, z: 0, pcb_port_id: "A-end" },
    ],
    vias: [],
  }
  // This crossing enters the normal conservative DRC precheck. It is distant
  // from the synthetic moving contact so it does not direct the force search.
  const fixedRoute: HighDensityRoute = {
    connectionName: "B",
    rootConnectionName: "B",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 30, y: -1, z: 0 },
      { x: 30, y: 1, z: 0 },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node-a",
    center: { x: 0, y: 0 },
    width: 100,
    height: 40,
    availableZ: [0, 1],
    portPoints: [
      { ...route.route[0]!, connectionName: "A" },
      { ...route.route[2]!, connectionName: "A" },
    ],
  }
  const connection: SimpleRouteConnection = {
    name: "A",
    pointsToConnect: [
      { x: -50, y: 0, layer: "top", pcb_port_id: "A-start" },
      { x: 50, y: 0, layer: "top", pcb_port_id: "A-end" },
    ],
  }
  const originalRoute = structuredClone(route)
  const originalFixedRoute = structuredClone(fixedRoute)
  // A deterministic synthetic objective isolates scheduler termination: every
  // upward interior force move improves severity, but never removes the error.
  // This is deliberately not a claim that the synthetic score is official DRC.
  const drcEvaluator: DrcEvaluator = (
    input: Parameters<DrcEvaluator>[0],
  ): ReturnType<DrcEvaluator> => {
    const midpoint = input.hdRoutes?.[0]?.route[1]
    if (!midpoint) throw new Error("Budget fixture requires its interior point")
    return [
      {
        type: "pcb_trace_error",
        pcb_trace_error_id: "severity-only-contact",
        pcb_trace_id: "A_0",
        center: { x: midpoint.x, y: midpoint.y - 1 },
        actual_clearance: 1 - 1 / (2 + midpoint.y),
        minimum_clearance: 1,
        message: "Synthetic severity-only contact for the repair pass budget",
      },
    ]
  }
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: [route],
    fixedHdRoutes: [fixedRoute],
    newConnections: [connection],
    drcEvaluator,
    connMap: new ConnectivityMap({
      A: ["A", "A-start", "A-end"],
      B: ["B"],
    }),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort,
  })
  let lastAcceptedRoutes = solver.outputHdRoutes
  let previousClearance = 0.5
  // A pass starts on one step and accepts its first force on the next. Bound
  // this test explicitly so removing the repair budget cannot hang hosted CI.
  for (
    let step = 0;
    step < 2 * maxNodePasses + 2 && !solver.solved && !solver.failed;
    step++
  ) {
    solver.step()
    if (solver.outputHdRoutes !== lastAcceptedRoutes) {
      const clearance = Number(solver.currentErrors[0]!.actual_clearance)
      expect(clearance).toBeGreaterThan(previousClearance)
      previousClearance = clearance
      lastAcceptedRoutes = solver.outputHdRoutes
    }
  }

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.stats).toMatchObject({
    initialDrcIssueCount: 1,
    finalDrcIssueCount: 1,
    nodeRepairAttemptCount: maxNodePasses,
    acceptedRepairCount: maxNodePasses,
    acceptedForceRepairCount: maxNodePasses,
    acceptedRerouteRepairCount: 0,
    budgetExhaustedNodeCount: 1,
  })
  expect(solver.getOutput()).toBe(lastAcceptedRoutes)
  expect(solver.getOutput()[0]).not.toEqual(originalRoute)
  expect(solver.getOutput()[0]!.route[0]).toEqual(originalRoute.route[0])
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(originalRoute.route.at(-1))
  expect(route).toEqual(originalRoute)
  expect(fixedRoute).toEqual(originalFixedRoute)
})
