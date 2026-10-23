import { expect, test } from "bun:test"
import { Pipeline9BoundaryContractSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundaryContractSolver"
import type { InputNodeWithPortPoints } from "../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("boundary families use the same canonical owner identity as distribution", () => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, i) => ({
    capacityMeshNodeId: id,
    center: { x: i === 0 ? -2.5 : 2.5, y: 0 },
    width: 5,
    height: 10,
    availableZ: [0],
    portPoints: [-0.2, 0.2].map((y, j) => ({
      x: 0,
      y,
      z: 0,
      portPointId: `p${j}`,
      connectionName: `c${j}`,
    })),
  }))
  const outputs: NodeWithPortPoints[][] = []
  for (const owners of [["left", "right"], ["right", "left"]] as const) {
    const inputs: InputNodeWithPortPoints[] = nodes.map((node) => ({
      ...node,
      portPoints: node.portPoints.map((port) => ({
        ...port,
        portPointId: port.portPointId!,
        connectionNodeIds: [...owners],
        distToCentermostPortOnZ: 0,
      })),
    }))
    const distribution = new UniformPortDistributionSolver({
      nodeWithPortPoints: nodes,
      inputNodesWithPortPoints: inputs,
      obstacles: [],
    })
    distribution.solve()
    const solver = new Pipeline9BoundaryContractSolver({
      distribution,
      inputNodesWithPortPoints: inputs,
      obstacles: [],
      layerCount: 2,
      traceWidth: 0.2,
      clearance: 0.15,
      hasPreloadedCopper: false,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.certifiedBoundaries).toBe(1)
    expect(solver.contracts[0]!.lanes).toHaveLength(2)
    outputs.push(solver.getOutput())
  }
  expect(outputs[0]).toEqual(outputs[1])
})
