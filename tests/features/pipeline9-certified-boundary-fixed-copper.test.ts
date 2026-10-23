import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("whole-cell routes conflicting with indexed physical preload copper roll their shared interface back", (): void => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, index) => {
    const terminal = { x: index === 0 ? -2 : 2, y: 1, z: 0, connectionName: "bus", portPointId: `${id}-terminal`, pcb_port_id: `${id}-pad` }
    const shared = { x: 0, y: 0, z: 0, connectionName: "bus", portPointId: "shared" }
    return { capacityMeshNodeId: id, center: { x: index === 0 ? -1 : 1, y: 0 }, width: 2, height: 4, availableZ: [0], portPoints: [terminal, shared], portPointsInPairs: [[terminal, { ...shared }]] }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: [0], portPoints: [{ ...node.portPoints[1]!, portPointId: "shared", connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 }] }))
  const obstacles = [{ type: "rect" as const, center: { x: 0, y: 0 }, width: 0.2, height: 0.6, layers: ["top"], connectedTo: [] }]
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2 })
  distribution.solve()
  const before = structuredClone(distribution.getOutput())
  const fixed = { connectionName: "foreign-preload", rootConnectionName: "foreign", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: -2.5, z: 0 }, { x: -1, y: 2.5, z: 0 }], vias: [] }
  const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2, traceWidth: 0.1, clearance: 0.1, hasPreloadedCopper: true,
    connMap: new ConnectivityMap({}), fixedHdRoutes: [fixed], immutableConnectionNames: new Set(),
    rules: { obstacles, layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1 } })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.boundaryProofMovedPorts).toBe(1)
  expect(solver.stats.boundaryProofCopperChecks).toBeGreaterThan(0)
  expect(solver.stats.boundaryProofRollbacks).toBe(1)
  expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(0)
  expect(solver.getOutput()).toEqual(before)
  expect(solver.certificates.cells.left).toBeUndefined()
})
