import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { CapacityMeshBoundaryEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshBoundaryEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("actual Pipeline9 sync and async factories enable only the explicit experiment", async () => {
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [], bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } }
  const nodes: CapacityMeshNode[] = [0, 1].map((x) => ({ capacityMeshNodeId: `n${x}`, center: { x, y: 0 }, width: 1, height: 1, layer: "top", availableZ: [0] }))
  for (const asynchronous of [false, true]) {
    for (const flag of [undefined, false, true]) {
      const options = { cacheProvider: null, experimentBoundaryEdges: flag }
      const pipeline = new Pipeline(structuredClone(srj), options)
      const edgeStep = pipeline.pipelineDef.find((step) => step.solverName === "edgeSolver")!
      pipeline.pipelineDef = [edgeStep]
      pipeline.capacityNodes = structuredClone(nodes)
      if (asynchronous) await pipeline.solveAsync({} as never)
      else pipeline.solve()
      expect(pipeline.solved).toBe(true)
      expect(pipeline.capacityEdges).toEqual([{ capacityMeshEdgeId: "ce0", nodeIds: ["n0", "n1"] }])
      expect(pipeline.edgeSolver).toBeInstanceOf(flag === true ? CapacityMeshBoundaryEdgeSolver : CapacityMeshEdgeSolver2_NodeTreeOptimization)
      expect(pipeline.getConstructorParams()[1].experimentBoundaryEdges).toBe(flag)
      expect(options).toEqual({ cacheProvider: null, experimentBoundaryEdges: flag })
      if (flag === true) expect(pipeline.edgeSolver!.stats.boundaryEdges.boundaryQueries).toBe(8)
    }
  }
})
