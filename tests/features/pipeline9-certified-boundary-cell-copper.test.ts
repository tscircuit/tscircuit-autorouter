import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("a moved cell's through-via is checked against indexed copper on another certified cell's intermediate layer", (): void => {
  const shared: PortPoint = { x: 0, y: 0.98, z: 0, connectionName: "bus", portPointId: "shared" }
  const left: PortPoint = { x: -0.2, y: 0.2, z: 3, connectionName: "bus", portPointId: "left", pcb_port_id: "left-pad" }
  const right: PortPoint = { x: 0.2, y: 0.2, z: 0, connectionName: "bus", portPointId: "right", pcb_port_id: "right-pad" }
  const bottom: PortPoint = { x: 0.1, y: -0.9, z: 1, connectionName: "other", portPointId: "bottom", pcb_port_id: "bottom-pad" }
  const top: PortPoint = { x: 0.1, y: 0.9, z: 1, connectionName: "other", portPointId: "top", pcb_port_id: "top-pad" }
  const nodes: NodeWithPortPoints[] = [
    { capacityMeshNodeId: "left", center: { x: -0.1, y: 0 }, width: 0.2, height: 2, availableZ: [0, 3], portPoints: [left, shared], portPointsInPairs: [[left, { ...shared }]] },
    { capacityMeshNodeId: "right", center: { x: 0.1, y: 0 }, width: 0.2, height: 2, availableZ: [0, 1], portPoints: [right, { ...shared }, bottom, top], portPointsInPairs: [[right, { ...shared }], [bottom, top]] },
  ]
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: node.availableZ!, portPoints: [{ ...shared, portPointId: "shared", connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 }] }))
  const obstacles = [{ type: "rect" as const, center: { x: 0.05, y: 0.98 }, width: 0.1, height: 0.01, layers: ["inner2"], connectedTo: [] }]
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 4, useLayerAwareGeometry: true, preserveSolitaryPorts: true })
  distribution.solve()
  const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 4, traceWidth: 0.1, clearance: 0.1, hasPreloadedCopper: false,
    connMap: new ConnectivityMap({}), fixedHdRoutes: [], immutableConnectionNames: new Set(),
    rules: { obstacles, layerCount: 4, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1 } })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.boundaryProofMovedPorts).toBe(1)
  expect(solver.stats.boundaryProofAcceptedVersions).toBeGreaterThan(0)
  expect(solver.stats.boundaryProofCopperChecks).toBeGreaterThan(0)
  expect(solver.stats.boundaryProofRollbacks).toBe(1)
  expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(0)
  expect(solver.getOutput()[0]!.portPoints[1]!.y).toBe(0.98)
  expect(solver.getOutput()[1]!.portPoints[1]!.y).toBe(0.98)
})
