import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 rejects a cloned incumbent without repeating official candidate checks", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "node-a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const errors: Pipeline9DrcError[] = [
    {
      type: "pcb_trace_error",
      pcb_trace_id: "A_0",
      pcb_trace_error_id: "overlap_A_0_B_0",
      center: { x: 0, y: 0.05 },
      actual_clearance: 0,
      minimum_clearance: 0.1,
    },
  ]
  let fullCalls = 0
  let localCalls = 0
  const evaluator: Pipeline9HighDensityDrcEvaluator = (): ReturnType<
    Pipeline9HighDensityDrcEvaluator
  > => {
    fullCalls++
    return { errors, errorsWithCenters: errors }
  }
  evaluator.evaluateLocalCandidate = (): {
    currentErrors: Pipeline9DrcError[]
    candidateErrors: Pipeline9DrcError[]
  } => {
    localCalls++
    return { currentErrors: errors, candidateErrors: errors }
  }
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "node-a",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: route.route.map((point) => ({
          ...point,
          connectionName: "A",
          rootConnectionName: "A",
        })),
      },
    ],
    hdRoutes: [route],
    fixedHdRoutes: [
      {
        ...route,
        connectionName: "B",
        rootConnectionName: "B",
        route: [
          { x: 0, y: -1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
      },
    ],
    newConnections: [
      {
        name: "A",
        pointsToConnect: route.route.map((point) => ({
          x: point.x,
          y: point.y,
          layer: "top",
        })),
      },
    ],
    drcEvaluator: evaluator,
    connMap: new ConnectivityMap({ A: ["A"], B: ["B"] }),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 1,
  })
  while (!solver.activeSubSolver && !solver.solved && !solver.failed) {
    solver.step()
  }
  expect(solver.activeSubSolver).not.toBeNull()
  const callsBeforeClone = { fullCalls, localCalls }
  // Model an ordinary reroute reproducing the last accepted geometry, with
  // different object identities. No solver-internal geometry cache is assumed.
  const { vias, ...clonedRoute } = structuredClone(route)
  solver.activeSubSolver!.routes = [{ vias, ...clonedRoute }]
  solver.activeSubSolver!.solved = true
  solver.step()
  expect({ fullCalls, localCalls }).toEqual(callsBeforeClone)
  expect(Number(solver.stats.unchangedCandidateCount)).toBeGreaterThan(0)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()[0]).toBe(route)
  expect(solver.currentErrors).toEqual(errors)
})
