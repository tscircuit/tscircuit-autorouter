import { expect, test } from "bun:test"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const createCrossingNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "x-crossing-available-z",
  center: { x: 0, y: 0 },
  width: 6,
  height: 6,
  availableZ: [0, 3],
  portPoints: [
    { connectionName: "connA", x: -2.5, y: -2.5, z: 0 },
    { connectionName: "connA", x: 2.5, y: 2.5, z: 0 },
    { connectionName: "connB", x: -2.5, y: 2.5, z: 0 },
    { connectionName: "connB", x: 2.5, y: -2.5, z: 0 },
  ],
})

const createHyperSolver = () =>
  new HyperSingleIntraNodeSolver({
    nodeWithPortPoints: createCrossingNode(),
    traceWidth: 0.15,
    viaDiameter: 0.3,
    effort: 1,
  })

const getSolvedRoutes = (solver: {
  getOutput?: () => HighDensityIntraNodeRoute[]
  solvedRoutes?: HighDensityIntraNodeRoute[]
}) =>
  typeof solver.getOutput === "function"
    ? solver.getOutput()
    : (solver.solvedRoutes ?? [])

const getUsedZ = (routes: HighDensityIntraNodeRoute[]) =>
  [
    ...new Set(routes.flatMap((route) => route.route.map((point) => point.z))),
  ].sort((a, b) => a - b)

const toRenderedArtifacts = (routes: HighDensityIntraNodeRoute[]) => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    defaultObstacleMargin: 0.15,
    bounds: {
      minX: -3,
      maxX: 3,
      minY: -3,
      maxY: 3,
    },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [
        {
          x: route.route[0]!.x,
          y: route.route[0]!.y,
          layer: "top",
        },
        {
          x: route.route[route.route.length - 1]!.x,
          y: route.route[route.route.length - 1]!.y,
          layer: "top",
        },
      ],
    })),
    traces: routes.map((route, index) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: `${route.connectionName}_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, 4),
    })),
  }

  return {
    srj,
    graphics: convertSrjToGraphicsObject(srj),
  }
}

const hasSegmentOnLayer = (
  routes: HighDensityIntraNodeRoute[],
  targetZ: number,
) =>
  routes.some((route) =>
    route.route.some((point, index) => {
      const nextPoint = route.route[index + 1]
      return (
        nextPoint !== undefined &&
        point.z === targetZ &&
        nextPoint.z === targetZ &&
        (Math.abs(point.x - nextPoint.x) > 1e-6 ||
          Math.abs(point.y - nextPoint.y) > 1e-6)
      )
    }),
  )

const expectMultilayerCrossingSolution = (
  routes: HighDensityIntraNodeRoute[],
) => {
  expect(routes).toHaveLength(2)
  expect(routes.map((route) => route.connectionName).sort()).toEqual([
    "connA",
    "connB",
  ])
  expect(getUsedZ(routes)).toEqual([0, 3])
  expect(routes.flatMap((route) => route.vias)).not.toHaveLength(0)
  expect(hasSegmentOnLayer(routes, 0)).toBe(true)
  expect(hasSegmentOnLayer(routes, 3)).toBe(true)

  for (const route of routes) {
    for (const point of route.route) {
      expect([0, 3]).toContain(point.z)
    }
  }

  const { srj, graphics } = toRenderedArtifacts(routes)
  const wireLayers = [
    ...new Set(
      srj.traces!.flatMap((trace) =>
        trace.route.flatMap((segment) =>
          segment.route_type === "wire" ? [segment.layer] : [],
        ),
      ),
    ),
  ].sort()
  const renderedLineLayers = [
    ...new Set(
      (graphics.lines ?? [])
        .map((line) => line.layer)
        .filter((layer): layer is string => typeof layer === "string"),
    ),
  ].sort()

  expect(wireLayers).toContain("bottom")
  expect(wireLayers).not.toContain("inner1")
  expect(
    srj.traces!.flatMap((trace) =>
      trace.route.filter(
        (segment) =>
          segment.route_type === "wire" && segment.layer === "bottom",
      ),
    ),
  ).not.toHaveLength(0)
  expect(renderedLineLayers).toContain("z3")
  expect(renderedLineLayers).not.toContain("z1")
}

const solvingCases = [
  {
    name: "CachedIntraNodeRouteSolver",
    hyperParameters: {},
  },
  {
    name: "MultiHeadPolyLineIntraNodeSolver3",
    hyperParameters: {
      MULTI_HEAD_POLYLINE_SOLVER: true,
      SEGMENTS_PER_POLYLINE: 6,
      BOUNDARY_PADDING: 0.05,
    },
  },
  {
    name: "FixedTopologyHighDensityIntraNodeSolver",
    hyperParameters: {
      FIXED_TOPOLOGY_HIGH_DENSITY_INTRA_NODE_SOLVER: true,
    },
  },
  {
    name: "HighDensitySolverA01",
    hyperParameters: {
      HIGH_DENSITY_A01: true,
    },
  },
  {
    name: "HighDensitySolverA03",
    hyperParameters: {
      HIGH_DENSITY_A03: true,
    },
  },
] as const

for (const { name, hyperParameters } of solvingCases) {
  test(`${name} solves X-crossing node using only z=0 and z=3`, () => {
    const hyperSolver = createHyperSolver()
    const solver = hyperSolver.generateSolver(hyperParameters as any)

    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expectMultilayerCrossingSolution(getSolvedRoutes(solver as any))
  })
}

test("HyperSingleIntraNodeSolver solves the X-crossing node without z=1 segments", () => {
  const solver = createHyperSolver()

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expectMultilayerCrossingSolution(solver.solvedRoutes)
})

test("SingleTransitionIntraNodeSolver candidate rejects the X-crossing node", () => {
  const hyperSolver = createHyperSolver()
  const solver = hyperSolver.generateSolver({
    CLOSED_FORM_SINGLE_TRANSITION: true,
  } as any)

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(String(solver.error)).toContain("Expected 1 route")
})

test("HyperSingleIntraNodeSolver does not apply the single-layer candidate to a multilayer node", () => {
  const hyperSolver = createHyperSolver()
  const solver = hyperSolver.generateSolver({
    SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS: true,
  } as any)

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(String(solver.error)).toContain("not applicable")
})
