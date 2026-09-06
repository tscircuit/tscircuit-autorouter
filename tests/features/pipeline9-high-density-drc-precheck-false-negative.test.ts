import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type { Pipeline9HighDensityForceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Pipeline9 honors an official owned DRC on apparently clear routing geometry", (): void => {
  const effort = 0.1
  const inputRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      rootConnectionName: "A",
      regionId: "node-a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node-a",
    center: { x: 0, y: 0 },
    width: 4,
    height: 2,
    availableZ: [0, 1],
    portPoints: inputRoutes[0]!.route.map((point) => ({
      ...point,
      connectionName: "A",
      rootConnectionName: "A",
    })),
  }
  const errors: Pipeline9DrcError[] = [
    {
      type: "pcb_trace_error",
      pcb_trace_id: "A_0",
      pcb_trace_error_id: "reported-owned-contact",
      center: { x: 0, y: 0.05 },
      actual_clearance: 0,
      minimum_clearance: 0.1,
    },
  ]
  let evaluatorCallCount = 0
  // Isolate the evaluator-authority contract: this is a synthetic reported
  // contact, not a claim that the clean geometric fixture has a real overlap.
  const drcEvaluator = Object.assign(
    (): ReturnType<DrcEvaluator> => {
      evaluatorCallCount++
      return { errors, errorsWithCenters: errors }
    },
    {
      getForceContext: (): Pipeline9HighDensityForceContext => ({
        connMap: new ConnectivityMap({ A: ["A", "A_0"] }),
        obstacles: [],
      }),
    },
  )
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: inputRoutes,
    fixedHdRoutes: [],
    newConnections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
    drcEvaluator,
    connMap: new ConnectivityMap({ A: ["A"] }),
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
  const originalRoutes = structuredClone(inputRoutes)
  const maxForceCandidates =
    getForceScalesForEffort(effort).length *
    getMaxTargetedCandidateAttemptsForEffort(effort)
  // One initialization, node selection and each force/seam stream completion
  // accompany the bounded force candidates. No neighboring seam exists here.
  for (
    let step = 0;
    step < maxForceCandidates + 4 &&
    !solver.activeSubSolver &&
    !solver.solved &&
    !solver.failed;
    step++
  ) {
    solver.step()
  }
  expect(solver.stats.initialDrcIssueCount).toBe(1)
  expect(evaluatorCallCount).toBeGreaterThan(0)
  expect(solver.activeSubSolver).not.toBeNull()
  // Complete an unchanged candidate without running the ordinary HD search.
  // It cannot erase the evaluator's reported contact or be accepted as repair.
  solver.activeSubSolver!.routes = structuredClone(inputRoutes)
  solver.activeSubSolver!.solved = true
  solver.step()
  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats).toMatchObject({
    initialDrcIssueCount: 1,
    finalDrcIssueCount: 1,
    drcNodeCount: 1,
    nodeRepairAttemptCount: 1,
    acceptedRepairCount: 0,
    exhaustedNodeCount: 1,
  })
  expect(solver.currentErrors).toEqual(errors)
  expect(solver.getOutput()).toBe(inputRoutes)
  expect(inputRoutes).toEqual(originalRoutes)
})
