import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("certificates reserve an uncertified foreign terminal disk with authoritative roots and physical layers", (): void => {
  for (const foreignZ of [0, 1]) {
    const connMap = new ConnectivityMap({ connectivity_net0: ["foreign"], connectivity_net1: ["core", "connectivity_net0"], connectivity_net2: ["bus"] })
    const point = (id: string, connectionName: string, rootConnectionName: string, x: number, y: number, z = 0): PortPoint => ({ portPointId: id, connectionName, rootConnectionName, x, y, z })
    const foreign = [point("foreign-boundary", "foreign", "connectivity_net0", 2, 2, foreignZ), point("foreign-interior", "foreign", "connectivity_net0", 0.5, 2, foreignZ)]
    const core = [point("core-a", "core", "connectivity_net1", 2.225001, 0.5), point("core-b", "core", "connectivity_net1", 2.225001, 3.5)]
    const shared = point("shared", "bus", "connectivity_net2", 4, 3.5)
    const a = point("bus-core", "bus", "connectivity_net2", 3.5, 3.5)
    const b = point("bus-far", "bus", "connectivity_net2", 6, 3.5)
    const nodes: NodeWithPortPoints[] = [
      { capacityMeshNodeId: "foreign-cell", center: { x: 1, y: 2 }, width: 2, height: 4, availableZ: [foreignZ], portPoints: foreign, portPointsInPairs: [[foreign[0]!, foreign[1]!]] },
      { capacityMeshNodeId: "core-cell", center: { x: 3, y: 2 }, width: 2, height: 4, availableZ: [0], portPoints: [...core, a, shared], portPointsInPairs: [[core[0]!, core[1]!], [a, shared]] },
      { capacityMeshNodeId: "far-cell", center: { x: 5, y: 2 }, width: 2, height: 4, availableZ: [0], portPoints: [b, { ...shared }], portPointsInPairs: [[b, { ...shared }]] },
    ]
    const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: node.availableZ!,
      portPoints: node.portPoints.filter((p) => p.portPointId === "shared").map((p) => ({ ...p, portPointId: "shared", connectionNodeIds: ["core-cell", "far-cell"], distToCentermostPortOnZ: 0 })) }))
    const obstacles = [{ type: "rect" as const, center: { x: 4, y: 2 }, width: 0.2, height: 0.6, layers: ["top"], connectedTo: [] }]
    const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2 })
    distribution.solve()
    const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles, layerCount: 2, traceWidth: 0.15, clearance: 0.15,
      hasPreloadedCopper: false, connMap, fixedHdRoutes: [], immutableConnectionNames: new Set(),
      rules: { obstacles, layerCount: 2, traceWidth: 0.15, viaDiameter: 0.5, obstacleMargin: 0.15 } })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.certificates.cells["foreign-cell"]).toBeUndefined()
    expect(solver.stats.boundaryProofMovedPorts).toBe(1)
    expect(solver.stats.boundaryProofReservationBuildRows).toBeGreaterThan(0)
    if (foreignZ === 0) {
      expect(solver.stats.parametricInterfaceCandidateRejections).toBeGreaterThan(0)
      expect(solver.stats.boundaryProofRollbacks).toBe(1)
      expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(0)
      expect(solver.certificates.cells["core-cell"]).toBeUndefined()
      expect(solver.stats.boundaryProofSceneVersions).toBe(2)
    } else {
      expect(solver.stats.boundaryProofRollbacks).toBe(0)
      expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(1)
      expect(solver.certificates.cells["core-cell"]).toBeDefined()
      expect(solver.certificates.cells["far-cell"]).toBeDefined()
      const changed = structuredClone(solver.getOutput())
      changed[0]!.portPoints[0]!.x -= 0.01
      changed[0]!.portPointsInPairs![0]![0]!.x = changed[0]!.portPoints[0]!.x
      const stale = new Pipeline9HighDensitySolver({
        nodePortPoints: changed, boundaryCertificates: solver.certificates, obstacles, fixedHdRoutes: [], connMap,
        layerCount: 2, traceWidth: 0.15, viaDiameter: 0.5, obstacleMargin: 0.15, effort: 1,
      })
      stale.step()
      expect(stale.stats.boundaryCertificateContextValid).toBe(0)
      expect(stale.stats.boundaryCertificateInvalidated).toBe(1)
      expect(stale.stats.boundaryCertificateSkippedSearches).toBe(0)
    }
  }
})
