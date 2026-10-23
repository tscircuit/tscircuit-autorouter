import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { BoundaryPhysicalRules } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/boundaryRouteCertificates"

test("a moved shared port has physical proofs for both neighbors which skip real detailed searches and reject stale assumptions", (): void => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, index) => {
    const terminal = { x: index === 0 ? -2 : 2, y: 1, z: 0, connectionName: "bus", rootConnectionName: "bus", pcb_port_id: `${id}-pad`, portPointId: `${id}-terminal` }
    const shared = { x: 0, y: 0, z: 0, connectionName: "bus", rootConnectionName: "bus", portPointId: "shared" }
    return { capacityMeshNodeId: id, center: { x: index === 0 ? -1 : 1, y: 0 }, width: 2, height: 4, availableZ: [0], portPoints: [terminal, shared], portPointsInPairs: [[terminal, { ...shared }]] }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: [0], portPoints: [{ ...node.portPoints[1]!, portPointId: "shared", connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 }] }))
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["bus", "left-pad", "right-pad"]])
  const rules: BoundaryPhysicalRules = { layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1,
    boardGeometry: { bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, minBoardEdgeClearance: 0 },
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.6, layers: ["top"], connectedTo: [] }] }
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles: rules.obstacles, layerCount: 2 })
  distribution.solve()
  const before = structuredClone(distribution.getOutput())
  const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles: rules.obstacles, layerCount: 2, traceWidth: 0.1, clearance: 0.1,
    hasPreloadedCopper: false, connMap, rules, fixedHdRoutes: [], immutableConnectionNames: new Set() })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(1)
  expect(solver.stats.boundaryProofCellCount).toBe(2)
  const output = solver.getOutput()
  expect(output[0]!.portPoints[1]).toEqual(output[1]!.portPoints[1]!)
  expect(output[0]!.portPointsInPairs![0]![1]).toEqual(output[0]!.portPoints[1]!)
  expect(output[0]!.portPoints[0]).toEqual(before[0]!.portPoints[0]!)
  expect(output[1]!.portPoints[0]).toEqual(before[1]!.portPoints[0]!)
  const params = { ...rules, nodePortPoints: output, fixedHdRoutes: [], connMap, effort: 0.1, preserveTerminalPcbPortIds: true, boundaryCertificates: solver.certificates }
  const detailed = new Pipeline9HighDensitySolver(params)
  detailed.solve()
  expect(detailed.solved).toBe(true)
  expect(detailed.stats.boundaryCertificateSkippedSearches).toBe(2)
  expect(detailed.stats.regularNodeCount).toBe(0)
  expect(detailed.stats.b01NodeCount).toBe(0)
  expect(detailed.routes).toHaveLength(2)
  const staleRules = new Pipeline9HighDensitySolver({ ...params, obstacleMargin: 0.12 })
  staleRules.step()
  expect(staleRules.stats.boundaryCertificateInvalidated).toBe(1)
  expect(staleRules.stats.boundaryCertificateSkippedSearches).toBe(0)
  const changed = structuredClone(output)
  changed[1]!.portPoints[1]!.y -= 0.01
  changed[1]!.portPointsInPairs![0]![1]!.y -= 0.01
  const staleInterface = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: changed })
  staleInterface.step()
  expect(staleInterface.stats.boundaryCertificateInvalidated).toBe(1)
  expect(staleInterface.stats.boundaryCertificateSkippedSearches).toBe(0)
  const staleCopper = new Pipeline9HighDensitySolver(params)
  staleCopper.fixedRouteReplacements.set("earlier-regional-repair", { ...detailed.routes[0]!, preloadedTraceIndex: 0, preloadedRouteIndex: 0 })
  staleCopper.step()
  expect(staleCopper.stats.boundaryCertificateInvalidated).toBe(1)
  expect(staleCopper.stats.boundaryCertificateSkippedSearches).toBe(0)
})
