import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver6 } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import datasetSrj14Sample01 from "../fixtures/datasets/dataset-srj14/sample01-source_net_5_mst1_0.srj.json" with {
  type: "json",
}

const srjWithPreloadedRoute: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  bounds: { minX: -1, minY: -1, maxX: 2, maxY: 2 },
  obstacles: [],
  connections: [],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "source_trace_0",
      connection_name: "source_net_0",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.2,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 1,
          y: 1,
          width: 0.2,
          layer: "top",
        },
      ],
    },
  ],
}

const srjWithBottomPreloadedRoute: SimpleRouteJson = {
  ...srjWithPreloadedRoute,
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace_0",
      connection_name: "source_net_0",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.2,
          layer: "bottom",
        },
        {
          route_type: "wire",
          x: 1,
          y: 1,
          width: 0.2,
          layer: "bottom",
        },
      ],
    },
  ],
}

const srjWithLongDiagonalRoute: SimpleRouteJson = {
  ...srjWithPreloadedRoute,
  bounds: { minX: -1, minY: -1, maxX: 12, maxY: 12 },
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "long_diagonal_trace",
      connection_name: "source_net_0",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.2,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 10,
          y: 10,
          width: 0.2,
          layer: "top",
        },
      ],
    },
  ],
}

const countTraceRouteObstacles = (srj: SimpleRouteJson) => {
  let obstacleCount = 0

  for (const trace of srj.traces ?? []) {
    for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex++) {
      const routePoint = trace.route[pointIndex]!
      const nextRoutePoint = trace.route[pointIndex + 1]

      if (
        routePoint.route_type === "wire" &&
        nextRoutePoint?.route_type === "wire" &&
        routePoint.layer === nextRoutePoint.layer
      ) {
        if (
          Math.hypot(
            nextRoutePoint.x - routePoint.x,
            nextRoutePoint.y - routePoint.y,
          ) > 0.001
        ) {
          obstacleCount++
        }
      } else if (routePoint.route_type === "via") {
        obstacleCount++
      } else if (routePoint.route_type === "through_obstacle") {
        if (
          Math.hypot(
            routePoint.end.x - routePoint.start.x,
            routePoint.end.y - routePoint.start.y,
          ) > 0.001
        ) {
          obstacleCount++
        }
      }
    }
  }

  return obstacleCount
}

const solvePreprocessStage = (solver: {
  solveUntilPhase: (phase: string) => void
}) => {
  solver.solveUntilPhase("escapeViaLocationSolver")
}

const getPreloadedRouteLine = (visualization: {
  lines?: Array<{
    points: Array<{ x: number; y: number }>
    strokeWidth?: number
    strokeColor?: string
    strokeDash?: string | number[]
    layer?: string
  }>
}) =>
  visualization.lines?.find(
    (line) =>
      line.strokeWidth === 0.2 &&
      line.points.length === 2 &&
      line.points[0]?.x === 0 &&
      line.points[0]?.y === 0 &&
      line.points[1]?.x === 1 &&
      line.points[1]?.y === 1,
  )

const hasPreloadedRouteLine = (
  visualization: Parameters<typeof getPreloadedRouteLine>[0],
) => Boolean(getPreloadedRouteLine(visualization))

test("pipeline initial visualization includes routes from the original SRJ", () => {
  const pipeline4Solver = new AutoroutingPipelineSolver4(srjWithPreloadedRoute)
  const pipeline6Solver = new AutoroutingPipelineSolver6(srjWithPreloadedRoute)

  expect(hasPreloadedRouteLine(pipeline4Solver.visualize())).toBe(true)
  expect(hasPreloadedRouteLine(pipeline6Solver.visualize())).toBe(true)
  expect(getPreloadedRouteLine(pipeline4Solver.visualize())?.strokeColor).toBe(
    "rgba(255,0,0,0.25)",
  )
})

test("pre-supplied routes on non-top layers keep absolute 25% opacity", () => {
  const solver = new AutoroutingPipelineSolver4(srjWithBottomPreloadedRoute)
  const routeLine = getPreloadedRouteLine(solver.visualize())

  expect(routeLine).toBeDefined()
  expect(routeLine?.layer).toBe("z1")
  expect(routeLine?.strokeDash).toEqual([0.2, 0.2])
  expect(routeLine?.strokeColor).toBe("rgba(0,0,255,0.25)")
})

test("preprocess stage visualization shows only the processed SRJ", () => {
  const solver = new AutoroutingPipelineSolver4(srjWithPreloadedRoute)

  solver.step()
  expect(solver.getCurrentPhase()).toBe("preprocessSimpleRouteJsonSolver")
  expect(hasPreloadedRouteLine(solver.visualize())).toBe(false)

  solver.step()

  const preprocessViz = solver.preprocessSimpleRouteJsonSolver!.visualize()

  expect(solver.getCurrentPhase()).toBe("escapeViaLocationSolver")
  expect(hasPreloadedRouteLine(preprocessViz)).toBe(true)
  expect(preprocessViz.rects).toHaveLength(2)
})

test("pipeline visualization keeps showing the original SRJ after preprocessing", () => {
  const solver = new AutoroutingPipelineSolver4(srjWithPreloadedRoute)

  solvePreprocessStage(solver)

  const pipelineViz = solver.visualize()

  expect(solver.originalSrj.obstacles).toHaveLength(0)
  expect(solver.srj.obstacles).toHaveLength(2)
  expect(hasPreloadedRouteLine(pipelineViz)).toBe(true)
  expect(pipelineViz.rects).toHaveLength(0)
})

test("solved pipeline visualization includes faded pre-supplied routes and generated routes", () => {
  const solver = new AutoroutingPipelineSolver4(srjWithPreloadedRoute)

  solvePreprocessStage(solver)

  solver.solved = true
  solver.highDensityRouteSolver = { visualize: () => ({ lines: [] }) } as any
  solver.netToPointPairsSolver = {
    newConnections: [{ name: "generated_conn", pointsToConnect: [] }],
    visualize: () => ({ lines: [] }),
  } as any
  solver.highDensityStitchSolver = {
    visualize: () => ({ lines: [] }),
    mergedHdRoutes: [
      {
        connectionName: "generated_conn",
        route: [
          { x: 0, y: -0.5, z: 0 },
          { x: 0, y: 0.5, z: 0 },
        ],
        traceThickness: 0.15,
        viaDiameter: 0.3,
        vias: [],
      },
    ],
  } as any

  const visualization = solver.visualize()
  const generatedRouteLine = visualization.lines?.find(
    (line) =>
      line.strokeWidth === 0.15 &&
      line.points.length === 2 &&
      line.points[0]?.x === 0 &&
      line.points[0]?.y === -0.5 &&
      line.points[1]?.x === 0 &&
      line.points[1]?.y === 0.5,
  )

  expect(getPreloadedRouteLine(visualization)?.strokeColor).toBe(
    "rgba(255,0,0,0.25)",
  )
  expect(generatedRouteLine).toBeDefined()
  expect(generatedRouteLine?.strokeColor).toBe("red")
})

test("pipeline4 preprocesses SRJ traces as non-rotated approximating obstacles", () => {
  const solver = new AutoroutingPipelineSolver4(srjWithPreloadedRoute)

  expect(solver.getCurrentPhase()).toBe("preprocessSimpleRouteJsonSolver")
  expect(solver.originalSrj.obstacles).toHaveLength(0)

  solvePreprocessStage(solver)

  expect(solver.originalSrj.obstacles).toHaveLength(0)

  const traceObstacles = solver.srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("trace_obstacle_source_trace_0"),
  )

  expect(traceObstacles).toHaveLength(2)
  expect(
    traceObstacles.every(
      (obstacle) =>
        obstacle.layers.length === 1 &&
        obstacle.layers[0] === "top" &&
        obstacle.ccwRotationDegrees === undefined,
    ),
  ).toBe(true)
})

test("pipeline6 preprocesses SRJ traces as rotated route obstacles", () => {
  const solver = new AutoroutingPipelineSolver6(srjWithPreloadedRoute)

  expect(solver.getCurrentPhase()).toBe("preprocessSimpleRouteJsonSolver")
  expect(solver.originalSrj.obstacles).toHaveLength(0)

  solvePreprocessStage(solver)

  expect(solver.originalSrj.obstacles).toHaveLength(0)

  const [traceObstacle] = solver.srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("trace_obstacle_source_trace_0"),
  )

  expect(traceObstacle).toBeDefined()
  expect(traceObstacle).toMatchObject({
    type: "rect",
    layers: ["top"],
    center: { x: 0.5, y: 0.5 },
    height: 0.2,
    ccwRotationDegrees: 45,
  })
  expect(traceObstacle!.width).toBeCloseTo(Math.SQRT2)
})

test("pipeline4 preprocess slices long diagonal route obstacles into smaller non-rotated approximations", () => {
  const solver = new AutoroutingPipelineSolver4(srjWithLongDiagonalRoute)

  solvePreprocessStage(solver)

  const traceObstacles = solver.srj.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("trace_obstacle_long_diagonal_trace"),
  )

  expect(traceObstacles.length).toBeGreaterThan(2)
  expect(
    traceObstacles.every(
      (obstacle) =>
        obstacle.ccwRotationDegrees === undefined &&
        Math.max(obstacle.width, obstacle.height) < 1,
    ),
  ).toBe(true)
})

test("pipeline4 and pipeline6 preprocess dataset-srj14 route obstacles", () => {
  const sample = datasetSrj14Sample01 as SimpleRouteJson
  const expectedTraceObstacleCount = countTraceRouteObstacles(sample)
  const pipeline4Solver = new AutoroutingPipelineSolver4(sample)
  const pipeline6Solver = new AutoroutingPipelineSolver6(sample)

  solvePreprocessStage(pipeline4Solver)
  solvePreprocessStage(pipeline6Solver)

  const pipeline4TraceObstacleCount = pipeline4Solver.srj.obstacles.filter(
    (obstacle) => obstacle.obstacleId?.startsWith("trace_obstacle_"),
  ).length
  const pipeline6TraceObstacleCount = pipeline6Solver.srj.obstacles.filter(
    (obstacle) => obstacle.obstacleId?.startsWith("trace_obstacle_"),
  ).length
  const pipeline4RotatedTraceObstacleCount =
    pipeline4Solver.srj.obstacles.filter(
      (obstacle) =>
        obstacle.obstacleId?.startsWith("trace_obstacle_") &&
        typeof obstacle.ccwRotationDegrees === "number",
    ).length

  expect(expectedTraceObstacleCount).toBeGreaterThan(0)
  expect(pipeline4TraceObstacleCount).toBeGreaterThanOrEqual(
    expectedTraceObstacleCount,
  )
  expect(pipeline4RotatedTraceObstacleCount).toBe(0)
  expect(pipeline6TraceObstacleCount).toBe(expectedTraceObstacleCount)
})
