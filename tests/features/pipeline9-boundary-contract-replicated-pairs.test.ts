import { expect, test } from "bun:test"
import { Pipeline9BoundaryContractSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundaryContractSolver"
import { UniformPortDistributionSolver } from "../../lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "../../lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("boundary stage updates both owner cells and pair replicas while retaining a terminal anchor", () => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, i) => {
    const portPoints = [-0.2, 0.2, -4].map((y, j) => ({ x: 0, y, z: 0, portPointId: `p${j}`, connectionName: `c${j}`, ...(j === 2 ? { pcb_port_id: "fixed-pad" } : {}) }))
    return { capacityMeshNodeId: id, center: { x: i === 0 ? -2.5 : 2.5, y: 0 }, width: 5, height: 10, availableZ: [0], portPoints, portPointsInPairs: [[{ ...portPoints[0]! }, { ...portPoints[2]! }]] }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((n) => ({ ...n, availableZ: [0], portPoints: n.portPoints.map((p) => ({ ...p, portPointId: p.portPointId!, connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 })) }))
  const obstacles = [{ type: "rect" as const, center: { x: 0, y: 0 }, width: 0.5, height: 2, layers: ["top"], connectedTo: [] }]
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles })
  distribution.solve()
  const anchorBefore = distribution.getOutput()[0]!.portPoints[2]!.y
  const params = { distribution, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2, traceWidth: 0.2, clearance: 0.15, hasPreloadedCopper: false }
  const solver = new Pipeline9BoundaryContractSolver(params)
  solver.solve()
  const [left, right] = solver.getOutput()
  expect(solver.stats.movedPortPoints).toBeGreaterThan(0)
  expect(left!.portPoints).toEqual(right!.portPoints)
  expect(left!.portPointsInPairs).toEqual(right!.portPointsInPairs)
  expect(left!.portPointsInPairs![0]![0]).toEqual(left!.portPoints[0]!)
  expect(left!.portPointsInPairs![0]![1]).toEqual(left!.portPoints[2]!)
  expect(left!.portPoints[2]!.y).toBe(anchorBefore)
  expect(() => new Pipeline9BoundaryContractSolver({ ...params, clearance: NaN })).toThrow("finite positive width")
  expect(() => new Pipeline9BoundaryContractSolver({ ...params, traceWidth: Infinity })).toThrow("finite positive width")
})
