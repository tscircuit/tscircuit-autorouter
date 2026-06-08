import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 high-density stage opts into GrowShrinkHighDensityIntraNodeSolver", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)

  const highDensityStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  expect(highDensityStep).toBeDefined()
  const [highDensityParams] = highDensityStep!.getConstructorParams({
    ...solver,
    uniformPortDistributionSolver: { getOutput: () => [] } as any,
    portPointPathingSolver: {
      getOutput: () => ({
        nodesWithPortPoints: [],
        inputNodeWithPortPoints: [],
      }),
    } as any,
  } as any)

  expect(
    (highDensityParams as any).useGrowShrinkHighDensityIntraNodeSolver,
  ).toBe(true)
  expect(
    (highDensityParams as any).growShrinkFallbackToInvalidGeometryOnFailure,
  ).toBe(true)
  expect(
    (highDensityParams as any).growShrinkMaxInnerIterationsPerGrowthAttempt,
  ).toBe(8_000)
})

test("Pipeline7 caps expensive post-processing stages for benchmark completion", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [],
  } as any)

  const globalDrcStep = solver.pipelineDef.find(
    (step) => step.solverName === "globalDrcForceImproveSolver",
  )
  expect(globalDrcStep).toBeDefined()
  const [globalDrcParams] = globalDrcStep!.getConstructorParams({
    ...solver,
    srjWithPointPairs: solver.srj,
    traceWidthSolver: { getHdRoutesWithWidths: () => [] },
  } as any)
  expect((globalDrcParams as any).maxIterations).toBe(16)
  expect((globalDrcParams as any).enableLargeBoardBroadFallback).toBe(false)
})

test("Pipeline7 passes large BGA components to local topology planning", () => {
  const srj = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [],
    connections: [],
  } as any
  const memberObstacles = Array.from({ length: 81 }, (_, index) => ({
    obstacleId: `bga-pad-${index}`,
    componentId: "bga_component",
    type: "rect",
    layers: ["top"],
    center: {
      x: (index % 9) * 0.4,
      y: Math.floor(index / 9) * 0.4,
    },
    width: 0.36,
    height: 0.36,
    connectedTo: [`source_net_${index}`],
  }))
  const componentDetectionOutput = {
    global: srj,
    components: [
      {
        componentId: "bga_component",
        componentKind: "bga",
        memberObstacleIds: memberObstacles.map(
          (obstacle) => obstacle.obstacleId,
        ),
        memberObstacles,
        replacementObstacle: {
          obstacleId: "component-region:bga_component",
          componentId: "bga_component",
          type: "rect",
          layers: ["top"],
          center: { x: 1.6, y: 1.6 },
          width: 3.56,
          height: 3.56,
          connectedTo: memberObstacles.flatMap(
            (obstacle) => obstacle.connectedTo,
          ),
        },
      },
    ],
  }

  const solver = new AutoroutingPipelineSolver7_MultiGraph(srj)
  const topologyStep = solver.pipelineDef.find(
    (step) => step.solverName === "topologyPlanningSolver",
  )
  expect(topologyStep).toBeDefined()

  const [topologyParams] = topologyStep!.getConstructorParams({
    ...solver,
    srjWithPointPairs: srj,
    componentDetectionSolver: {
      getOutput: () => componentDetectionOutput,
    },
  } as any)

  expect(
    (topologyParams as any).componentDetectionOutput.components,
  ).toHaveLength(1)
  expect(
    (topologyParams as any).componentDetectionOutput.components[0]
      .memberObstacles,
  ).toHaveLength(81)
})
