import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test.failing("Pipeline9 spaces displaced H3 DDR ports on their physical two-layer shared edge", (): void => {
  const fixture: { traceWidth: number; nodes: NodeWithPortPoints[] } =
    JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/assets/h3-ddr-displaced-port-pair.json",
          import.meta.url,
        ),
        "utf8",
      ),
    )
  const original = structuredClone(fixture.nodes)
  const ownerIds: [string, string] = [
    fixture.nodes[0]!.capacityMeshNodeId,
    fixture.nodes[1]!.capacityMeshNodeId,
  ]
  const inputNodes: InputNodeWithPortPoints[] = fixture.nodes.map((node) => ({
    ...node,
    availableZ: node.availableZ!,
    portPoints: node.portPoints.map((port) => ({
      ...port,
      portPointId: port.portPointId!,
      connectionNodeIds: ownerIds,
      distToCentermostPortOnZ: 0,
    })),
  }))
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
    layerCount: 2,
    minTraceWidth: fixture.traceWidth,
    bounds: { minX: 100, maxX: 160, minY: -100, maxY: -30 },
    obstacles: [],
    connections: [],
  })
  // Replay the captured upstream assignments through the actual stage factory.
  Object.assign(pipeline, {
    portPointPathingSolver: {
      getOutput: () => ({
        nodesWithPortPoints: fixture.nodes,
        inputNodeWithPortPoints: inputNodes,
      }),
    },
  })
  const step = pipeline.pipelineDef.find(
    (stage) => stage.solverName === "uniformPortDistributionSolver",
  )!
  const [params] = step.getConstructorParams(pipeline)
  const solver = new UniformPortDistributionSolver(
    params as UniformPortDistributionSolverInput,
  )
  const edge = solver.mapOfOwnerPairToSharedEdge.get("cmn_21|cmn_9")
  expect(edge).toBeDefined()
  expect(edge!.length).toBeCloseTo(0.4, 8)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const output = solver.getOutput()
  const ports = output[0]!.portPoints.toSorted((a, b) => a.y - b.y)
  expect(ports).toHaveLength(5)
  for (const [index, port] of ports.entries()) {
    expect(port.x).toBeCloseTo(edge!.x1, 8)
    if (index > 0) {
      expect(port.y - ports[index - 1]!.y).toBeCloseTo(0.08, 8)
    }
    const opposite = output[1]!.portPoints.find(
      (candidate) => candidate.portPointId === port.portPointId,
    )!
    expect({ x: opposite.x, y: opposite.y }).toEqual({ x: port.x, y: port.y })
  }
  expect(fixture.nodes).toEqual(original)
})
