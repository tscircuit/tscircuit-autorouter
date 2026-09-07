import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import type {
  Pipeline9HighDensityForceFamily,
  Pipeline9HighDensityForceFeedback,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

type ForcePolicyAccess = {
  activeForceCandidates: Generator<
    HighDensityRoute[],
    void,
    Pipeline9HighDensityForceFeedback
  >
  activeForceFamily: Pipeline9HighDensityForceFamily
}

test("Pipeline9 exhausts force and seam work without an adaptive rerouter or weaker DRC gate", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "node-a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const routes = [route]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node-a",
    center: { x: 0, y: 0 },
    width: 4,
    height: 2,
    availableZ: [0, 1],
    portPoints: [route.route[0]!, route.route.at(-1)!].map((point) => ({
      ...point,
      connectionName: "A",
    })),
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0.17 },
        width: 0.2,
        height: 0.1,
        layers: ["top"],
        connectedTo: ["B", "port-b-start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad-b-start",
          pcb_port_id: "port-b-start",
        },
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0.17, layer: "top", pcb_port_id: "port-b-start" },
          { x: 0, y: 0.8, layer: "top", pcb_port_id: "port-b-end" },
        ],
      },
    ],
  }
  const connMap = new ConnectivityMap({
    A: ["A"],
    B: ["B", "port-b-start", "port-b-end"],
  })
  const connections = [srj.connections[0]!]
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections,
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: routes,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: routes,
    fixedHdRoutes: [],
    newConnections: connections,
    drcEvaluator,
    connMap,
    colorMap: {},
    obstacles: srj.obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 1,
  })
  const original = structuredClone({ routes, node, srj })
  // Any attempted child handoff fails loudly, including after both fixed
  // streams finish. No mock replaces the official candidate evaluator.
  Object.defineProperty(solver, "activeSubSolver", { writable: false })
  solver.step()
  expect(solver.currentErrors).toHaveLength(1)
  expect(solver.currentErrors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_id: "pad-b-start",
  })
  const initialErrors = structuredClone(solver.currentErrors)
  solver.step()
  const worsening = structuredClone(route)
  worsening.route[1]!.y = 0.02
  worsening.route[2]!.y = 0.02
  const access = solver as unknown as ForcePolicyAccess
  // A controlled trial isolates scheduling; the physical .07 -> .05 gap
  // regression still has to be rejected by the real scoped/full DRC gates.
  access.activeForceCandidates = (function* (): Generator<
    HighDensityRoute[],
    void,
    Pipeline9HighDensityForceFeedback
  > {
    access.activeForceFamily = "pad-wire"
    yield [worsening]
  })()
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.stats).toMatchObject({
    initialDrcIssueCount: 1,
    finalDrcIssueCount: 1,
    forceCandidateAttemptCount: 1,
    localCandidateEvaluationCount: 1,
    fullCandidateEvaluationCount: 0,
    acceptedRepairCount: 0,
    acceptedRerouteRepairCount: 0,
    rerouteStepTimeMs: 0,
    exhaustedNodeCount: 1,
  })
  expect(solver.stats.lastExhaustedNodeError).toContain("Force and seam")
  expect(solver.currentErrors).toEqual(initialErrors)
  expect(solver.getOutput()).toBe(routes)
  expect({ routes, node, srj }).toEqual(original)
})
