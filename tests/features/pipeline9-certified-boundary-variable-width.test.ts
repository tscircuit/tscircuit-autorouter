import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import type { BoundaryPhysicalRules } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/boundaryRouteCertificates"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("boundary allocation encloses all nominal widths while physical certificates retain each demand's actual width", (): void => {
  const nodes: NodeWithPortPoints[] = ["left", "right"].map((id, index) => {
    const terminal = { x: index === 0 ? -3 : 3, y: 1, z: 0, connectionName: "wide", pcb_port_id: `${id}-pad`, portPointId: `${id}-terminal` }
    const shared = { x: 0, y: 0, z: 0, connectionName: "wide", portPointId: "shared" }
    const thinStart = { x: index === 0 ? -2 : 1, y: -2, z: 0, connectionName: `thin-${id}`, portPointId: `${id}-thin-start` }
    const thinEnd = { ...thinStart, x: thinStart.x + 1, portPointId: `${id}-thin-end` }
    return { capacityMeshNodeId: id, center: { x: index === 0 ? -1.5 : 1.5, y: 0 }, width: 3, height: 8, availableZ: [0], portPoints: [terminal, shared, thinStart, thinEnd], portPointsInPairs: [[terminal, { ...shared }], [thinStart, thinEnd]] }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: [0], portPoints: [{ ...node.portPoints[1]!, portPointId: "shared", connectionNodeIds: ["left", "right"], distToCentermostPortOnZ: 0 }] }))
  const rules: BoundaryPhysicalRules = { layerCount: 2, traceWidth: 0.1, traceWidthByConnection: { wide: 0.4, "thin-left": 0.1, "thin-right": 0.1, "changed-preloaded-section": 0.6 }, viaDiameter: 0.3, obstacleMargin: 0.1,
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.6, layers: ["top"], connectedTo: [] }] }
  const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles: rules.obstacles, layerCount: 2 })
  distribution.solve()
  const params = { distribution, inputNodesWithPortPoints: inputNodes, obstacles: rules.obstacles, layerCount: 2, traceWidth: 0.6, clearance: 0.1, hasPreloadedCopper: false,
    connMap: new ConnectivityMap({}), rules, fixedHdRoutes: [], immutableConnectionNames: new Set<string>() }
  for (const traceWidth of [0.1, 0.4]) expect(() => new Pipeline9CertifiedBoundarySolver({ ...params, traceWidth })).toThrow("Boundary allocation and physical proof rules disagree")
  for (const traceWidth of [0.6, 0.8]) {
    const solver = new Pipeline9CertifiedBoundarySolver({ ...params, traceWidth })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(1)
    const routes = Object.values(solver.certificates.cells).flatMap((cell) => cell.routes)
    expect(routes.filter((route) => route.connectionName === "wide").map((route) => route.traceThickness)).toEqual([0.4, 0.4])
    expect(routes.filter((route) => route.connectionName.startsWith("thin-")).map((route) => route.traceThickness)).toEqual([0.1, 0.1])
  }
  expect(rules.traceWidth).toBe(0.1)
  expect(rules.traceWidthByConnection!.wide).toBe(0.4)
  for (const width of [Number.NaN, Number.POSITIVE_INFINITY, 0, -0.1]) expect(() => new Pipeline9CertifiedBoundarySolver({ ...params, rules: { ...rules, traceWidthByConnection: { wide: width } } })).toThrow("Boundary allocation and physical proof rules disagree")
  expect(() => new Pipeline9CertifiedBoundarySolver({ ...params, layerCount: 4 })).toThrow("Boundary allocation and physical proof rules disagree")
  expect(() => new Pipeline9CertifiedBoundarySolver({ ...params, clearance: 0.09 })).toThrow("Boundary allocation and physical proof rules disagree")
})
