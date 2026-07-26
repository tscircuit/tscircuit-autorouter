import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { Pipeline9ExactDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-exact-drc-repair-solver"

const getViaPosition = (route: HighDensityRoute) => {
  for (
    let pointIndex = 0;
    pointIndex < route.route.length - 1;
    pointIndex += 1
  ) {
    const point = route.route[pointIndex]!
    const nextPoint = route.route[pointIndex + 1]!
    if (point.z !== nextPoint.z) return { x: point.x, y: point.y }
  }
  throw new Error(`Route "${route.connectionName}" has no via transition`)
}

test("Pipeline9 coalesces post-repair same-net vias with stale via metadata", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -1, y: -0.5, layer: "top", pointId: "a_start" },
          { x: 1, y: -0.5, layer: "bottom", pointId: "a_end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: -1, y: 0.5, layer: "top", pointId: "b_start" },
          { x: 1, y: 0.5, layer: "bottom", pointId: "b_end" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      // Deliberately rounded metadata: the exact transition is at x=0.0005.
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: -0.5, z: 0, pcb_port_id: "a_start" },
        { x: 0.0005, y: 0, z: 0 },
        { x: 0.0005, y: 0, z: 1 },
        { x: 1, y: -0.5, z: 1, pcb_port_id: "a_end" },
      ],
    },
    {
      connectionName: "B",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0.18, y: 0 }],
      route: [
        { x: -1, y: 0.5, z: 0, pcb_port_id: "b_start" },
        { x: 0.18, y: 0, z: 0 },
        { x: 0.18, y: 0, z: 1 },
        { x: 1, y: 0.5, z: 1, pcb_port_id: "b_end" },
      ],
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const routeA = routes?.[0]
    const routeB = routes?.[1]
    if (!routeA || !routeB) return []
    const viaA = getViaPosition(routeA)
    const viaB = getViaPosition(routeB)
    const distance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
    if (distance <= 1e-6 || distance >= 0.3) return []
    const error = {
      type: "pcb_via_clearance_error",
      error_type: "pcb_via_clearance_error",
      message: "Same-net vias are too close",
      pcb_via_ids: ["via_a", "via_b"],
      center: {
        x: (viaA.x + viaB.x) / 2,
        y: (viaA.y + viaB.y) / 2,
      },
    }
    return { errors: [error], errorsWithCenters: [error] }
  }
  const solver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    connMap: new ConnectivityMap({ same_net: ["A", "B"] }),
    originalObstacles: [],
    b01BaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })
  const privateSolver = solver as unknown as {
    runPostRepairSameNetViaMerge: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
    getSnapshot: (routes: HighDensityRoute[]) => { count: number }
    postRepairSameNetViaMergeAttempts: number
    postRepairSameNetViaMergeDrcEvaluations: number
    postRepairSameNetViaMergeCandidatesAccepted: number
    postRepairSameNetViaMergeIterations: number
  }

  expect(privateSolver.getSnapshot(hdRoutes).count).toBe(1)
  const output = privateSolver.runPostRepairSameNetViaMerge(hdRoutes)

  expect(privateSolver.getSnapshot(output).count).toBe(0)
  expect(getViaPosition(output[0]!)).toEqual(getViaPosition(output[1]!))
  expect(output[0]?.route[0]).toEqual(hdRoutes[0]?.route[0])
  expect(output[0]?.route.at(-1)).toEqual(hdRoutes[0]?.route.at(-1))
  expect(output[1]?.route[0]).toEqual(hdRoutes[1]?.route[0])
  expect(output[1]?.route.at(-1)).toEqual(hdRoutes[1]?.route.at(-1))
  expect(privateSolver.postRepairSameNetViaMergeAttempts).toBe(1)
  expect(privateSolver.postRepairSameNetViaMergeDrcEvaluations).toBe(1)
  expect(privateSolver.postRepairSameNetViaMergeCandidatesAccepted).toBe(1)
  expect(privateSolver.postRepairSameNetViaMergeIterations).toBeLessThanOrEqual(
    8,
  )

  const incompleteConnectivitySolver = new Pipeline9ExactDrcRepairSolver({
    srj,
    hdRoutes,
    drcEvaluator,
    connMap: new ConnectivityMap({ incomplete_net: ["A"] }),
    originalObstacles: [],
    b01BaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  }) as unknown as {
    runPostRepairSameNetViaMerge: (
      routes: HighDensityRoute[],
    ) => HighDensityRoute[]
  }
  expect(
    incompleteConnectivitySolver.runPostRepairSameNetViaMerge(hdRoutes),
  ).toBe(hdRoutes)
})
