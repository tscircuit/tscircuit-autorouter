import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("an unsupported neighbor rolls a moved port back in every owner and pair replica and terminates without a false certificate", (): void => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, index) => {
    const terminal = { x: index === 0 ? -2 : 2, y: 1, z: 0, connectionName: "bus", pcb_port_id: `${id}-pad`, portPointId: `${id}-terminal` }
    const shared = { x: 0, y: 0, z: 0, connectionName: "bus", portPointId: "shared" }
    return { capacityMeshNodeId: id, center: { x: index === 0 ? -1 : 1, y: 0 }, width: 2, height: 4, availableZ: [0], portPoints: [terminal, shared], portPointsInPairs: [[terminal, { ...shared }]] }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: [0], portPoints: [{ ...node.portPoints[1]!, portPointId: "shared", connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 }] }))
  const obstacles = [
    { type: "rect" as const, center: { x: 0, y: 0 }, width: 0.2, height: 0.6, layers: ["top"], connectedTo: [] },
    { type: "rect" as const, center: { x: -1, y: 0 }, width: 0.2, height: 4, layers: ["top"], connectedTo: [] },
  ]
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2 })
  distribution.solve()
  const before = structuredClone(distribution.getOutput())
  const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2, traceWidth: 0.1, clearance: 0.1, hasPreloadedCopper: false,
    connMap: new ConnectivityMap({}), fixedHdRoutes: [], immutableConnectionNames: new Set(),
    rules: { obstacles, layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1, boardGeometry: { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, minBoardEdgeClearance: 0 } } })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.boundaryProofMovedPorts).toBe(1)
  expect(solver.stats.boundaryProofRollbacks).toBe(1)
  expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(0)
  expect(solver.stats.boundaryProofUnsupported).toBeGreaterThan(0)
  expect(solver.iterations).toBeLessThan(solver.MAX_ITERATIONS)
  expect(solver.getOutput()).toEqual(before)
  expect(solver.certificates.cells.left).toBeUndefined()
  expect(solver.certificates.cells.right).toBeUndefined()
})
