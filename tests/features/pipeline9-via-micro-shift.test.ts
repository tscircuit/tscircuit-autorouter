import { expect, test } from "bun:test"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { Pipeline9ExactDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-exact-drc-repair-solver"

const getViaPosition = (route: HighDensityRoute) => {
  for (let pointIndex = 0; pointIndex < route.route.length - 1; pointIndex++) {
    const point = route.route[pointIndex]!
    const nextPoint = route.route[pointIndex + 1]!
    if (point.z !== nextPoint.z) return { x: point.x, y: point.y }
  }
  throw new Error(`Route "${route.connectionName}" has no via transition`)
}

test("Pipeline9 micro-shifts a candidate via when strict DRC improves", () => {
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
          { x: -1, y: 0, layer: "top", pointId: "a_start" },
          { x: 1, y: 0, layer: "bottom", pointId: "a_end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: -1, y: 0.18, layer: "top", pointId: "b_start" },
          { x: 1, y: 0.18, layer: "bottom", pointId: "b_end" },
        ],
      },
    ],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "A",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "a_start" },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1, pcb_port_id: "a_end" },
      ],
    },
    {
      connectionName: "B",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0.18 }],
      route: [
        { x: -1, y: 0.18, z: 0, pcb_port_id: "b_start" },
        { x: 0, y: 0.18, z: 0 },
        { x: 0, y: 0.18, z: 1 },
        { x: 1, y: 0.18, z: 1, pcb_port_id: "b_end" },
      ],
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ routes }) => {
    const routeA = routes?.[0]
    const routeB = routes?.[1]
    if (!routeA || !routeB) return []
    const viaA = getViaPosition(routeA)
    const viaB = getViaPosition(routeB)
    if (Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y) >= 0.3) {
      return []
    }
    const error = {
      type: "pcb_via_clearance_error",
      error_type: "pcb_via_clearance_error",
      message: "Candidate vias are too close",
      pcb_via_ids: ["via_a", "via_b"],
      candidate_pcb_trace_ids: ["A_0", "B_0"],
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
    originalObstacles: [],
    ijumpBaseObstacles: [],
    viaHoleDiameter: 0.15,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
  })

  const output = (
    solver as unknown as {
      tryViaMicroShift: (
        routes: HighDensityRoute[],
        error: Record<string, unknown>,
      ) => HighDensityRoute[] | undefined
    }
  ).tryViaMicroShift(hdRoutes, {
    type: "pcb_via_clearance_error",
    error_type: "pcb_via_clearance_error",
    message: "Candidate vias are too close",
    pcb_via_ids: ["via_a", "via_b"],
    candidate_pcb_trace_ids: ["A_0", "B_0"],
    center: { x: 0, y: 0.09 },
  })

  expect(output).toBeDefined()
  if (!output) throw new Error("Expected the via micro-shift to improve DRC")
  expect(drcEvaluator({ traces: [], routes: output })).toEqual([])
  expect(output[0]?.route[0]).toMatchObject({
    x: -1,
    y: 0,
    z: 0,
    pcb_port_id: "a_start",
  })
  expect(output[0]?.route.at(-1)).toMatchObject({
    x: 1,
    y: 0,
    z: 1,
    pcb_port_id: "a_end",
  })
  expect(
    Math.hypot(
      getViaPosition(output[0]!).x - getViaPosition(output[1]!).x,
      getViaPosition(output[0]!).y - getViaPosition(output[1]!).y,
    ),
  ).toBeGreaterThanOrEqual(0.3)
})
