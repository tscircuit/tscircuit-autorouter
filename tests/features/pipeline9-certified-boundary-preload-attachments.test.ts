import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("source-proven physical preload attachments are restored and fixed in every owner without freezing unrelated ports", (): void => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, index) => {
    const shared = ["free", "fixednet"].map((name, n) => ({ x: 0, y: n * 0.05, z: 0, connectionName: name, portPointId: `p${n}` }))
    const terminals = shared.map((point, n) => ({ ...point, x: index === 0 ? -2 : 2, y: n === 0 ? -1 : 1, portPointId: `${id}-t${n}`, pcb_port_id: `${id}-pad${n}` }))
    return { capacityMeshNodeId: id, center: { x: index === 0 ? -1 : 1, y: 0 }, width: 2, height: 4, availableZ: [0], portPoints: [...terminals, ...shared], portPointsInPairs: [[terminals[0]!, { ...shared[0]! }], [terminals[1]!, { ...shared[1]! }]] }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: [0], portPoints: node.portPoints.slice(2).map((point) => ({ ...point, portPointId: point.portPointId!, connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 })) }))
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles: [], layerCount: 2 })
  distribution.solve()
  const before = structuredClone(distribution.getOutput())
  expect(before[0]!.portPoints[3]!.y).not.toBe(0.05)
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["fixednet", "left-pad1", "right-pad1"], ["free", "left-pad0", "right-pad0"]])
  const fixed = { connectionName: "physical-preload", rootConnectionName: connMap.getNetConnectedToId("fixednet")!, traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0, y: 0.05, z: 0 }, { x: 0, y: 0.5, z: 0 }], vias: [] }
  const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles: [], layerCount: 2, traceWidth: 0.1, clearance: 0.1, hasPreloadedCopper: true,
    connMap, fixedHdRoutes: [fixed], immutableConnectionNames: new Set(), rules: { obstacles: [], layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1 } })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.boundaryProofRestoredAttachments).toBe(1)
  for (const [index, node] of solver.getOutput().entries()) {
    expect(node.portPoints[3]!.y).toBe(0.05)
    expect(node.portPointsInPairs![1]![1]).toEqual(node.portPoints[3]!)
    expect(node.portPoints[2]).toEqual(before[index]!.portPoints[2]!)
    expect(node.portPoints[0]).toEqual(before[index]!.portPoints[0]!)
    expect(node.portPoints[1]).toEqual(before[index]!.portPoints[1]!)
  }
  expect(() => new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles: [], layerCount: 2, traceWidth: 0.1, clearance: 0.1, hasPreloadedCopper: true,
    connMap, fixedHdRoutes: [{ ...fixed, traceThickness: NaN }], immutableConnectionNames: new Set(), rules: { obstacles: [], layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1 } })).toThrow("invalid boundary copper")
  for (const z of [NaN, -1, 0.5, 2]) {
    expect(() => new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, obstacles: [], layerCount: 2, traceWidth: 0.1, clearance: 0.1, hasPreloadedCopper: true,
      connMap, fixedHdRoutes: [{ ...fixed, route: fixed.route.map((point) => ({ ...point, z })) }], immutableConnectionNames: new Set(), rules: { obstacles: [], layerCount: 2, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1 } })).toThrow("invalid boundary copper")
  }
})
