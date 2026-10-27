import { expect, test } from "bun:test"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("actual arc keepout cannot expose a layer-five centerline less than one trace radius from its edge", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: 280.7, maxX: 284.5, minY: 68.5, maxY: 72.7 },
    layerCount: 8,
    minTraceWidth: 0.1,
    connections: [],
    obstacles: [
      { type: "rect", componentId: "pcb_component_altium_541", center: { x: 282.39900086, y: 70.9168 }, width: 1.10000034, height: 1.5999993399999999, layers: ["top"], connectedTo: ["source_net_altium_pcb_378", "pcb_port_altium_6926"] },
      { obstacleId: "pcb_keepout_altium_arc_4591", type: "rect", layers: ["inner5"], center: { x: 283.19625859999996, y: 70.27820082 }, width: 0.5334000000000098, height: 0.5334000000000098, connectedTo: [] },
    ],
  }
  const original = structuredClone(input)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  pipeline.srjWithPointPairs = input
  pipeline.componentDetectionSolver = { getOutput: () => [] } as any
  const stage = pipeline.pipelineDef.find((definition) => definition.solverName === "topologyPlanningSolver")!
  const planned = stage.getConstructorParams(pipeline)[0].inputSrj
  const covers = (nodes: CapacityMeshNode[], x: number, y: number): boolean => nodes.some((node) =>
    !node._containsObstacle && node.availableZ.includes(5) &&
    Math.abs(node.center.x - x) <= node.width / 2 + 1e-8 &&
    Math.abs(node.center.y - y) <= node.height / 2 + 1e-8,
  )
  const solveMesh = (srj: SimpleRouteJson): CapacityMeshNode[] => {
    const solver = new RectDiffPipeline({ simpleRouteJson: structuredClone(srj) as any, maxGapFillPasses: 4 })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    return solver.getOutput().meshNodes as CapacityMeshNode[]
  }
  const before = solveMesh(input)
  const after = solveMesh(planned)
  const x = 282.923909, y = 70.13022918299998
  const physicalGap = input.obstacles[1].center.x - input.obstacles[1].width / 2 - x
  expect(physicalGap).toBeGreaterThan(0)
  expect(physicalGap).toBeLessThan(input.minTraceWidth / 2)
  expect(covers(before, x, y)).toBe(true)
  expect(covers(after, x, y)).toBe(false)
  expect(covers(before, 281.2, 72.1)).toBe(true)
  expect(covers(after, 281.2, 72.1)).toBe(true)
  expect(input).toEqual(original)
})
