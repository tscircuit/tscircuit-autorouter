import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import {
  TraceWidthSolver,
  type TraceWidthSolverInput,
} from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types"

const createRoute = (): HighDensityRoute => ({
  connectionName: "POWER",
  rootConnectionName: "POWER",
  traceThickness: 0.1,
  viaDiameter: 0.6,
  route: [
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
  ],
  vias: [],
})

const createCorridorObstacles = (edgeClearance: number): Obstacle[] => [
  {
    type: "rect",
    center: { x: 5, y: edgeClearance + 0.5 },
    width: 20,
    height: 1,
    layers: ["top"],
    connectedTo: [],
  },
  {
    type: "rect",
    center: { x: 5, y: -(edgeClearance + 0.5) },
    width: 20,
    height: 1,
    layers: ["top"],
    connectedTo: [],
  },
]

test("Pipeline9 never silently reduces a connection below its required width", () => {
  const cases = [
    {
      nominalTraceWidth: 0.18,
      minTraceWidth: 0.18,
      edgeClearance: 0.17,
      expectedMinimum: 0.18,
      shouldFail: true,
    },
    {
      nominalTraceWidth: 0.5,
      minTraceWidth: 0.18,
      edgeClearance: 0.2,
      expectedMinimum: 0.18,
      shouldFail: false,
    },
  ]

  for (const testCase of cases) {
    const route = createRoute()
    const srj: SimpleRouteJson = {
      layerCount: 1,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      bounds: { minX: -1, minY: -2, maxX: 11, maxY: 2 },
      obstacles: createCorridorObstacles(testCase.edgeClearance),
      connections: [
        {
          name: "POWER",
          nominalTraceWidth: testCase.nominalTraceWidth,
          minTraceWidth: testCase.minTraceWidth,
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 10, y: 0, layer: "top" },
          ],
        },
      ],
    }
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
    pipeline.traceSimplificationSolver = {
      simplifiedHdRoutes: [route],
    } as TraceSimplificationSolver
    const traceWidthStep = pipeline.pipelineDef.find(
      (step) => step.solverName === "traceWidthSolver",
    )!
    const [input] = traceWidthStep.getConstructorParams(pipeline) as [
      TraceWidthSolverInput,
    ]
    const solver = new TraceWidthSolver(input)

    expect(input.connection[0]?.minTraceWidth).toBe(testCase.expectedMinimum)
    solver.solve()

    if (testCase.shouldFail) {
      expect(solver.failed).toBeTrue()
      expect(solver.error).toContain(
        `required minimum trace width of ${testCase.expectedMinimum}mm`,
      )
      expect(solver.getHdRoutesWithWidths()).toEqual([])
      continue
    }

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const outputRoute = solver.getHdRoutesWithWidths()[0]!
    const outputWidths = [
      outputRoute.traceThickness,
      ...outputRoute.route.map(
        (point) => point.traceThickness ?? outputRoute.traceThickness,
      ),
    ]
    expect(Math.min(...outputWidths)).toBeGreaterThanOrEqual(
      testCase.expectedMinimum,
    )
    expect(outputWidths).not.toContain(0.1)
  }
})
