import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import {
  getDrcScaledMaxIterations,
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
  MAX_ERROR_MOVE,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import type { Pipeline9HighDensityForceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

test("Pipeline9 visits later affected nodes before repeating an improving early node", (): void => {
  const effort = 1
  const maxNodePasses = getDrcScaledMaxIterations(1, effort)
  const maxForceStepsPerPass =
    getForceScalesForEffort(effort).length *
    getMaxTargetedCandidateAttemptsForEffort(effort)
  const maxForceTravel =
    MAX_ERROR_MOVE *
    Math.max(...getForceScalesForEffort(effort).map(Math.abs)) *
    getMaxTargetedCandidateAttemptsForEffort(effort) *
    maxNodePasses
  const routes: HighDensityRoute[] = ["A", "B"].map(
    (connectionName, index): HighDensityRoute => ({
      connectionName,
      rootConnectionName: connectionName,
      regionId: index === 0 ? "node-a" : "node-b",
      startPcbPortId: `${connectionName}-start`,
      endPcbPortId: `${connectionName}-end`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [-50, 0, 50].map((x): HighDensityRoute["route"][number] => ({
        x,
        y: index * 100,
        z: 0,
      })),
      vias: [],
    }),
  )
  const nodes: NodeWithPortPoints[] = routes.map((route, index) => ({
    capacityMeshNodeId: route.regionId!,
    center: { x: 0, y: index * 100 },
    width: 100,
    // Height 40 assumed one nudge per accepted pass. The unchanged 48-pass
    // cap now permits each pass's best bounded cumulative candidate; reserve
    // its derived travel so this synthetic objective tests scheduling, not
    // accidental exhaustion at a fixture boundary.
    height: 40 + 2 * maxForceTravel,
    availableZ: [0, 1],
    portPoints: [route.route[0]!, route.route[2]!].map((point) => ({
      ...point,
      connectionName: route.connectionName,
    })),
  }))
  const connections: SimpleRouteConnection[] = routes.map((route) => ({
    name: route.connectionName,
    pointsToConnect: [
      {
        x: -50,
        y: route.route[0]!.y,
        layer: "top",
        pcb_port_id: route.startPcbPortId,
      },
      {
        x: 50,
        y: route.route[2]!.y,
        layer: "top",
        pcb_port_id: route.endPcbPortId,
      },
    ],
  }))
  const originalInputs = structuredClone({ routes, nodes, connections })
  const connMap = new ConnectivityMap({
    A: ["A", "A_0", "A-start", "A-end"],
    B: ["B", "B_0", "B-start", "B-end"],
  })
  // Synthetic objectives isolate node scheduling, not official DRC accuracy.
  // The real native force and unchanged acceptance gate can improve A forever;
  // B disappears after one upward interior move in its distant native domain.
  const drcEvaluator = Object.assign(
    (input: Parameters<DrcEvaluator>[0]): ReturnType<DrcEvaluator> => {
      const a = input.hdRoutes?.[0]?.route[1]
      const b = input.hdRoutes?.[1]?.route[1]
      if (!a || !b) {
        throw new Error("Node cursor fixture requires both interior points")
      }
      return [
        {
          type: "pcb_trace_error",
          pcb_trace_error_id: "early-severity-contact",
          pcb_trace_id: "A_0",
          center: { x: a.x, y: a.y - 1 },
          actual_clearance: 1 - 1 / (2 + a.y),
          minimum_clearance: 1,
          message: "Synthetic early node with continuing severity progress",
        },
        ...(b.y === 100
          ? [
              {
                type: "pcb_trace_error",
                pcb_trace_error_id: "later-removable-contact",
                pcb_trace_id: "B_0",
                center: { x: b.x, y: b.y - 1 },
                actual_clearance: 0.5,
                minimum_clearance: 1,
                message: "Synthetic later node removable by one force move",
              },
            ]
          : []),
      ]
    },
    {
      getForceContext: (): Pipeline9HighDensityForceContext => ({
        connMap,
        obstacles: [],
      }),
    },
  )
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: nodes,
    hdRoutes: routes,
    fixedHdRoutes: [],
    newConnections: connections,
    drcEvaluator,
    connMap,
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
  const selectedNodeIds: string[] = []
  const accepted: Array<{ aY: number; bY: number; errorCount: number }> = []
  let previousRoutes = solver.outputHdRoutes
  // A keeps its native first-visit cap; B needs exactly one additional pass.
  // Each severity-only pass enumerates its existing native slots, with one
  // start and one exhaustion step. Keep initialization/termination bounded too.
  for (
    let step = 0;
    step < (maxForceStepsPerPass + 2) * (maxNodePasses + 1) + 2 &&
    !solver.solved &&
    !solver.failed;
    step++
  ) {
    const previousActiveNode = solver.activeNode
    solver.step()
    if (solver.activeNode && solver.activeNode !== previousActiveNode) {
      selectedNodeIds.push(solver.activeNode.capacityMeshNodeId)
    }
    if (!solver.attemptedNodeIds.has("node-b")) {
      expect(solver.outputHdRoutes[1]).toBe(routes[1])
    }
    if (solver.outputHdRoutes === previousRoutes) continue
    previousRoutes = solver.outputHdRoutes
    accepted.push({
      aY: previousRoutes[0]!.route[1]!.y,
      bY: previousRoutes[1]!.route[1]!.y,
      errorCount: solver.currentErrors.length,
    })
  }

  expect(selectedNodeIds.slice(0, 3)).toEqual(["node-a", "node-b", "node-a"])
  expect(selectedNodeIds.filter((id) => id === "node-a")).toHaveLength(
    maxNodePasses,
  )
  expect(selectedNodeIds.filter((id) => id === "node-b")).toHaveLength(1)
  expect(accepted).toHaveLength(maxNodePasses + 1)
  expect(accepted[0]!.aY).toBeGreaterThan(0)
  expect(accepted[0]!.bY).toBe(100)
  expect(accepted[0]!.errorCount).toBe(2)
  expect(accepted[1]!.aY).toBe(accepted[0]!.aY)
  expect(accepted[1]!.bY).toBeGreaterThan(100)
  expect(accepted[1]!.errorCount).toBe(1)
  expect(accepted[2]!.aY).toBeGreaterThan(accepted[1]!.aY)
  expect(accepted[2]!.bY).toBe(accepted[1]!.bY)
  expect(accepted[2]!.errorCount).toBe(1)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.stats).toMatchObject({
    initialDrcIssueCount: 2,
    finalDrcIssueCount: 1,
    attemptedNodeCount: 2,
    nodeRepairAttemptCount: maxNodePasses + 1,
    acceptedNodeCount: 2,
    acceptedRepairCount: maxNodePasses + 1,
    acceptedDrcCountReducingRepairCount: 1,
    acceptedSeverityOnlyRepairCount: maxNodePasses,
    acceptedForceRepairCount: maxNodePasses + 1,
    acceptedSeamForceRepairCount: 0,
    acceptedRerouteRepairCount: 0,
    budgetExhaustedNodeCount: 1,
  })
  expect(solver.getOutput()).toBe(previousRoutes)
  for (const [index, route] of routes.entries()) {
    expect(solver.getOutput()[index]!.route[0]).toEqual(route.route[0])
    expect(solver.getOutput()[index]!.route.at(-1)).toEqual(route.route.at(-1))
  }
  expect({ routes, nodes, connections }).toEqual(originalInputs)
})
