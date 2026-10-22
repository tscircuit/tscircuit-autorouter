import { expect, test } from "bun:test"
import { Pipeline9BoundaryContractSolver, allocateBoundaryLanes } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundaryContractSolver"
import { UniformPortDistributionSolver } from "../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("boundary contracts construct obstacle-clear lanes shared identically by both cells, preserve anchors and report inconclusive capacity", () => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, i) => ({
    capacityMeshNodeId: id,
    center: { x: i === 0 ? -2.5 : 2.5, y: 0 }, width: 5, height: 10,
    availableZ: [0],
    portPoints: [-0.2, 0.2].map((y, j) => ({ x: 0, y, z: 0, portPointId: `p${j}`, connectionName: `c${j}` })),
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((n) => ({ ...n, availableZ: [0], portPoints: n.portPoints.map((p) => ({ ...p, portPointId: p.portPointId!, connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 })) }))
  const obstacles = [{ type: "rect" as const, center: { x: 0, y: 0 }, width: 0.5, height: 2, layers: ["top"], connectedTo: [] }]
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles })
  distribution.solve()
  const solver = new Pipeline9BoundaryContractSolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2, traceWidth: 0.2, clearance: 0.15, hasPreloadedCopper: false })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.contracts.length).toBe(1)
  const [left, right] = solver.getOutput()
  expect(left!.portPoints).toEqual(right!.portPoints)
  expect(left!.portPoints[0]!.y).toBeLessThan(-1.25)
  expect(left!.portPoints[1]!.y).toBeGreaterThan(1.25)
  expect(nodes[0]!.portPoints[0]!.y).toBe(-0.2)
  expect(allocateBoundaryLanes([{ id: "fixed", preferred: 0, fixed: true }], [{ min: 1, max: 2 }], 0.35)).toBeNull()
  expect(allocateBoundaryLanes([{ id: "a", preferred: 0, fixed: false }, { id: "b", preferred: 0, fixed: false }], [{ min: 0, max: 0.3 }], 0.35)).toBeNull()
  expect(allocateBoundaryLanes([{ id: "a", preferred: 1, fixed: false }, { id: "b", preferred: 1, fixed: true }], [{ min: 0, max: 2 }], 0.35)).toEqual([0.65, 1])
})
