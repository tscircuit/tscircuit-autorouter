import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { SimpleRouteJson } from "lib/types"

test("topology planning reserves trace radius around unowned barriers without changing physical inputs or component islands", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: 0, maxX: 6, minY: 0, maxY: 6 },
    layerCount: 8,
    minTraceWidth: 0.1,
    obstacles: [
      { type: "rect", obstacleId: "keepout", center: { x: 3, y: 3 }, width: 0.5, height: 0.6, layers: ["inner5"], connectedTo: [] },
      { type: "rect", obstacleId: "pad", componentId: "component", center: { x: 3, y: 3 }, width: 2, height: 2, layers: ["top"], connectedTo: ["net", "pcb-port"] },
    ],
    connections: [],
  }
  const original = structuredClone(input)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  const physicalBefore = structuredClone(pipeline.srj.obstacles)
  const originalBefore = structuredClone(pipeline.originalSrj.obstacles)
  pipeline.srjWithPointPairs = input
  pipeline.componentDetectionSolver = { getOutput: () => [{ componentId: "component", componentKind: "soic", bounds: { __type: "rect", minX: 2, maxX: 4, minY: 2, maxY: 4 } }] } as any
  const stage = pipeline.pipelineDef.find((definition) => definition.solverName === "topologyPlanningSolver")!
  const params = stage.getConstructorParams(pipeline)[0] as ConstructorParameters<typeof MultiGraphTopologyPlannerSolver>[0]
  const planned = params.inputSrj
  expect(planned).not.toBe(input)
  expect(planned.obstacles).not.toBe(input.obstacles)
  expect(planned.obstacles[0]).not.toBe(input.obstacles[0])
  expect(planned.obstacles[0].width).toBeCloseTo(0.6, 12)
  expect(planned.obstacles[0].height).toBeCloseTo(0.7, 12)
  expect(planned.obstacles[0].center).toBe(input.obstacles[0].center)
  expect(planned.obstacles[0].layers).toBe(input.obstacles[0].layers)
  expect(planned.obstacles[1]).toBe(input.obstacles[1])
  expect(planned.connections).toBe(input.connections)
  expect(input).toEqual(original)

  const topology = new MultiGraphTopologyPlannerSolver(params)
  const globalStage = topology.pipelineDef.find((definition) => definition.solverName === "globalTopologySolver")!
  const globalSrj = globalStage.getConstructorParams(topology)[0].simpleRouteJson
  const globalBarrier = globalSrj.obstacles.find((obstacle) => obstacle.obstacleId === "keepout")!
  expect(globalBarrier.width).toBeCloseTo(0.6, 12)
  expect(globalBarrier.height).toBeCloseTo(0.7, 12)
  const replacement = globalSrj.obstacles.find((obstacle) => obstacle.obstacleId === "component_component_bounds")!
  expect(replacement.width).toBe(2)
  expect(replacement.height).toBe(2)

  const localSrj = topology.getOutput().componentNoConnectionSrjs[0]
  const localBarrier = localSrj.obstacles.find((obstacle) => obstacle.obstacleId === "keepout")!
  const localPad = localSrj.obstacles.find((obstacle) => obstacle.obstacleId === "pad")!
  expect(localBarrier.width).toBeCloseTo(0.6, 12)
  expect(localBarrier.height).toBeCloseTo(0.7, 12)
  expect(localPad.width).toBe(2)
  expect(localPad.height).toBe(2)

  pipeline.topologyPlanningSolver = topology
  stage.onSolved!(pipeline)
  expect(pipeline.srj.obstacles).toEqual(physicalBefore)
  expect(pipeline.srjWithPointPairs).toBe(input)
  expect(pipeline.originalSrj.obstacles).toEqual(originalBefore)
  expect(input).toEqual(original)
})
