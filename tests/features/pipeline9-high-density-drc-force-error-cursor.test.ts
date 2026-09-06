import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { getDrcScaledMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type { Pipeline9HighDensityForceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

test("Pipeline9 advances the node force cursor past an improving early error", (): void => {
  const routes: HighDensityRoute[] = ["A", "B"].map(
    (connectionName, index): HighDensityRoute => ({
      connectionName,
      rootConnectionName: connectionName,
      regionId: "cursor-node",
      startPcbPortId: `${connectionName}-start`,
      endPcbPortId: `${connectionName}-end`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [-50, 0, 50].map((x): HighDensityRoute["route"][number] => ({
        x,
        y: index * 5,
        z: 0,
      })),
      vias: [],
    }),
  )
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cursor-node",
    center: { x: 0, y: 0 },
    width: 100,
    height: 40,
    availableZ: [0, 1],
    portPoints: routes.flatMap((route) => [
      { ...route.route[0]!, connectionName: route.connectionName },
      { ...route.route[2]!, connectionName: route.connectionName },
    ]),
  }
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
  const originalInputs = structuredClone({ routes, node, connections })
  const connMap = new ConnectivityMap({
    A: ["A", "A_0", "A-start", "A-end"],
    B: ["B", "B_0", "B-start", "B-end"],
  })
  // Synthetic objectives isolate scheduler fairness while exercising the real
  // force operator and unchanged quality gate. A can improve forever without
  // disappearing; B disappears after its first upward interior movement.
  const drcEvaluator = Object.assign(
    (input: Parameters<DrcEvaluator>[0]): ReturnType<DrcEvaluator> => {
      const currentRoutes = input.hdRoutes ?? input.routes
      const a = currentRoutes?.[0]?.route[1]
      const b = currentRoutes?.[1]?.route[1]
      if (!a || !b) {
        throw new Error("Cursor fixture requires both interior points")
      }
      return [
        {
          type: "pcb_trace_error",
          pcb_trace_error_id: "early-severity-contact",
          pcb_trace_id: "A_0",
          center: { x: a.x, y: a.y - 1 },
          actual_clearance: 1 - 1 / (2 + a.y),
          minimum_clearance: 1,
          message: "Synthetic early error with continuing severity progress",
        },
        ...(b.y === 5
          ? [
              {
                type: "pcb_trace_error",
                pcb_trace_error_id: "later-repairable-contact",
                pcb_trace_id: "B_0",
                center: { x: b.x, y: b.y - 1 },
                actual_clearance: 0.5,
                minimum_clearance: 1,
                message: "Synthetic later error removable by one force move",
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
    nodePortPoints: [node],
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
    effort: 1,
  })
  const accepted: Array<{ aY: number; bY: number; errorCount: number }> = []
  let previousRoutes = solver.outputHdRoutes
  const maxNodePasses = getDrcScaledMaxIterations(2, 1)
  for (
    let step = 0;
    step < 2 * maxNodePasses + 2 && accepted.length < 3;
    step++
  ) {
    solver.step()
    if (solver.outputHdRoutes === previousRoutes) continue
    previousRoutes = solver.outputHdRoutes
    accepted.push({
      aY: previousRoutes[0]!.route[1]!.y,
      bY: previousRoutes[1]!.route[1]!.y,
      errorCount: solver.currentErrors.length,
    })
  }

  expect(accepted).toHaveLength(3)
  expect(accepted[0]!.aY).toBeGreaterThan(0)
  expect(accepted[0]!.bY).toBe(5)
  expect(accepted[0]!.errorCount).toBe(2)
  expect(accepted[1]!.aY).toBe(accepted[0]!.aY)
  expect(accepted[1]!.bY).toBeGreaterThan(5)
  expect(accepted[1]!.errorCount).toBe(1)
  // Removing B changes the error count. Modulo the new list, the persisted
  // cursor returns to A without resetting the budget or losing the incumbent.
  expect(accepted[2]!.aY).toBeGreaterThan(accepted[1]!.aY)
  expect(accepted[2]!.bY).toBe(accepted[1]!.bY)
  expect(accepted[2]!.errorCount).toBe(1)
  expect(solver.failed).toBe(false)
  expect(solver.stats).toMatchObject({
    initialDrcIssueCount: 2,
    finalDrcIssueCount: 1,
    nodeRepairAttemptCount: 3,
    acceptedForceRepairCount: 3,
    acceptedSeamForceRepairCount: 0,
    acceptedRerouteRepairCount: 0,
    budgetExhaustedNodeCount: 0,
  })
  for (const [index, route] of routes.entries()) {
    expect(solver.outputHdRoutes[index]!.route[0]).toEqual(route.route[0])
    expect(solver.outputHdRoutes[index]!.route.at(-1)).toEqual(
      route.route.at(-1),
    )
  }
  expect({ routes, node, connections }).toEqual(originalInputs)
})
