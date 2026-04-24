import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "lib"
import {
  MIN_VIA_TO_VIA_CLEARANCE,
  PREFERRED_VIA_TO_VIA_CLEARANCE,
  getDrcErrors,
} from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

const createRoute = (connectionName: string, x: number): HighDensityRoute => ({
  connectionName,
  rootConnectionName: connectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x, y: -2, z: 0 },
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
    { x, y: 2, z: 1 },
  ],
  vias: [{ x, y: 0 }],
})

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  defaultObstacleMargin: 0.1,
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  obstacles: [],
  connections: [
    {
      name: "net_a",
      pointsToConnect: [
        { x: 0, y: -2, layer: "top" },
        { x: 0, y: 2, layer: "bottom" },
      ],
    },
    {
      name: "net_b",
      pointsToConnect: [
        { x: 0.38, y: -2, layer: "top" },
        { x: 0.38, y: 2, layer: "bottom" },
      ],
    },
  ],
}

const getViaClearance = (routes: HighDensityRoute[]) => {
  const [left, right] = routes.map((route) => route.vias[0])
  if (!left || !right) {
    throw new Error("Expected two vias")
  }
  return Math.hypot(left.x - right.x, left.y - right.y) - 0.3
}

const getTracePadClearance = (route: HighDensityRoute) => {
  let minDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < route.route.length - 1; index += 1) {
    const start = route.route[index]
    const end = route.route[index + 1]
    if (!start || !end) continue
    for (let step = 0; step <= 100; step += 1) {
      const t = step / 100
      const x = start.x + (end.x - start.x) * t
      const y = start.y + (end.y - start.y) * t
      const dx = Math.max(Math.abs(x) - 0.2, 0)
      const dy = Math.max(Math.abs(y) - 0.2, 0)
      minDistance = Math.min(minDistance, Math.hypot(dx, dy))
    }
  }

  return minDistance - 0.05
}

test("global DRC force repair prefers 0.2 via clearance", () => {
  const inputRoutes = [createRoute("net_a", 0), createRoute("net_b", 0.38)]
  const inputDrc = getDrcErrors(
    convertToCircuitJson(srj, inputRoutes, srj.minTraceWidth),
  )

  expect(inputDrc.errors).toHaveLength(1)
  expect(getViaClearance(inputRoutes)).toBeLessThan(MIN_VIA_TO_VIA_CLEARANCE)

  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    effort: 1,
  })
  solver.solve()

  const outputRoutes = solver.getOutput()
  const outputDrc = getDrcErrors(
    convertToCircuitJson(srj, outputRoutes, srj.minTraceWidth),
  )

  expect(outputDrc.errors).toHaveLength(0)
  expect(getViaClearance(outputRoutes)).toBeGreaterThanOrEqual(
    PREFERRED_VIA_TO_VIA_CLEARANCE,
  )
})

test("global DRC force repair pushes traces 0.16 from pads", () => {
  const padSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    defaultObstacleMargin: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        obstacleId: "pcb_smtpad_pad",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["pcb_smtpad_pad"],
      },
    ],
    connections: [
      {
        name: "net_a",
        pointsToConnect: [
          { x: -1, y: 0.24, layer: "top" },
          { x: 1, y: 0.24, layer: "top" },
        ],
      },
    ],
  }
  const inputRoutes: HighDensityRoute[] = [
    {
      connectionName: "net_a",
      rootConnectionName: "net_a",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0.24, z: 0 },
        { x: 1, y: 0.24, z: 0 },
      ],
      vias: [],
    },
  ]

  const inputDrc = getDrcErrors(
    convertToCircuitJson(padSrj, inputRoutes, padSrj.minTraceWidth),
  )

  expect(inputDrc.errors.length).toBeGreaterThan(0)

  const solver = new GlobalDrcForceImproveSolver({
    srj: padSrj,
    hdRoutes: inputRoutes,
    effort: 1,
  })
  solver.solve()

  const [outputRoute] = solver.getOutput()
  if (!outputRoute) {
    throw new Error("Expected output route")
  }
  const outputDrc = getDrcErrors(
    convertToCircuitJson(padSrj, [outputRoute], padSrj.minTraceWidth),
  )
  const traceToPadClearance = getTracePadClearance(outputRoute)

  expect(outputDrc.errors).toHaveLength(0)
  expect(traceToPadClearance).toBeGreaterThanOrEqual(0.16)
})

test("global DRC force repair supports the public drcEvaluator API", () => {
  const inputRoutes = [createRoute("net_a", 0), createRoute("net_b", 0.38)]
  const drcEvaluator: DrcEvaluator = ({ traces }) => {
    const [leftTrace, rightTrace] = traces
    const leftVia = leftTrace?.route.find(
      (segment) => segment.route_type === "via",
    )
    const rightVia = rightTrace?.route.find(
      (segment) => segment.route_type === "via",
    )

    if (!leftVia || !rightVia) return []

    const gap = Math.hypot(leftVia.x - rightVia.x, leftVia.y - rightVia.y) - 0.3
    if (gap >= PREFERRED_VIA_TO_VIA_CLEARANCE) return []

    return [
      {
        message: `trace clearance gap: ${gap.toFixed(3)}mm required: 0.200mm`,
        center: {
          x: (leftVia.x + rightVia.x) / 2,
          y: (leftVia.y + rightVia.y) / 2,
        },
        pcb_trace_id: "net_a_0",
      },
    ]
  }

  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: inputRoutes,
    effort: 1,
    drcEvaluator,
  })
  solver.solve()

  const outputRoutes = solver.getOutput()
  expect(getViaClearance(outputRoutes)).toBeGreaterThanOrEqual(
    PREFERRED_VIA_TO_VIA_CLEARANCE,
  )
})
