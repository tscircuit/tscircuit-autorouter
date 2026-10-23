import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { createBoundaryInterfaceIndex, getBoundaryInterfaceSceneKey } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/boundaryRouteCertificates"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("rollback rebuilds reservations and rechecks nearby foreign certificates while retaining distant proofs", (): void => {
  const nodes: NodeWithPortPoints[] = []
  for (const [name, x, y] of [["bottom", 0, -1], ["top", 0, 1], ["distant", 10, 1]] as const) {
    for (const side of [-1, 1]) {
      const id = `${name}-${side}`
      const terminal = { connectionName: name, portPointId: `${id}-pad`, pcb_port_id: `${id}-pad`, x: x + side * 2, y: y + (name === "bottom" ? -0.5 : 0.5), z: 0 }
      const shared = { connectionName: name, portPointId: `${name}-shared`, x, y, z: 0 }
      nodes.push({ capacityMeshNodeId: id, center: { x: x + side, y }, width: 2, height: 2, availableZ: [0], portPoints: [terminal, shared], portPointsInPairs: [[terminal, { ...shared }]] })
    }
  }
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => {
    const shared = node.portPoints[1]!
    const name = shared.connectionName
    return { ...node, availableZ: [0], portPoints: [{ ...shared, portPointId: shared.portPointId!, connectionNodeIds: [`${name}--1`, `${name}-1`], distToCentermostPortOnZ: 0 }] }
  })
  const obstacles = [
    { type: "rect" as const, center: { x: 0, y: -1.3 }, width: 0.2, height: 1.4, layers: ["top"], connectedTo: [] },
    ...[0, 10].map((x) => ({ type: "rect" as const, center: { x, y: 1 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: [] })),
  ]
  const rules = { obstacles, layerCount: 2, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15 }
  const connMap = new ConnectivityMap({})
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2 })
  distribution.solve()
  const fixed = { connectionName: "foreign-fixed", rootConnectionName: "foreign-fixed", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: -2.5, z: 0 }, { x: -1, y: 0.5, z: 0 }], vias: [] }
  const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2, traceWidth: 0.15, clearance: 0.15,
    hasPreloadedCopper: true, connMap, rules, fixedHdRoutes: [fixed], immutableConnectionNames: new Set() })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.boundaryProofMovedPorts).toBe(3)
  expect(solver.stats.boundaryProofRollbacks).toBe(1)
  expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(2)
  expect(solver.stats.boundaryProofSceneVersions).toBe(2)
  expect(solver.stats.boundaryProofInvalidatedCertificates).toBe(3)
  expect(solver.stats.boundaryProofAcceptedVersions).toBeGreaterThanOrEqual(7)
  expect(solver.stats.boundaryProofCellCount).toBe(4)
  for (const name of ["top", "distant"]) for (const side of [-1, 1]) expect(solver.certificates.cells[`${name}-${side}`]).toBeDefined()
  const finalIndex = createBoundaryInterfaceIndex(solver.getOutput(), rules, connMap)
  expect(solver.certificates.context.interfaceSceneKey).toBe(getBoundaryInterfaceSceneKey(finalIndex.ports))
  expect(solver.iterations).toBeLessThan(solver.MAX_ITERATIONS)
})
