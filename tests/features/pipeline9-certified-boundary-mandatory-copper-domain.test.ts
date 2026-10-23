import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9CertifiedBoundarySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9CertifiedBoundarySolver"
import { createBoundaryInterfaceIndex, normalizeBoundaryNodeRoots } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/boundaryRouteCertificates"
import { constructPipeline9ParametricCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constructPipeline9ParametricCell"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("mandatory copper filters every formula before selection and only exhausted moves roll back", (): void => {
  const nodes: NodeWithPortPoints[] = [-1, 1].map((side) => {
    const terminal = { connectionName: "signal", portPointId: `pad${side}`, pcb_port_id: `pad${side}`, x: side * 2, y: 1.5, z: 0 }
    const shared = { connectionName: "signal", portPointId: "shared", x: 0, y: 1, z: 0 }
    return { capacityMeshNodeId: `cell${side}`, center: { x: side, y: 1 }, width: 2, height: 2, availableZ: [0], portPoints: [terminal, shared], portPointsInPairs: [[terminal, { ...shared }]] }
  })
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({ ...node, availableZ: [0], portPoints: [{ ...node.portPoints[1]!, portPointId: "shared", connectionNodeIds: ["cell-1", "cell1"], distToCentermostPortOnZ: 0 }] }))
  const rules = { layerCount: 2, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15,
    obstacles: [{ type: "rect" as const, center: { x: 0, y: 1 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: [] }] }
  const connMap = new ConnectivityMap({})
  const fixed: HighDensityRoute = { connectionName: "foreign", rootConnectionName: "foreign", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: -2.5, z: 0 }, { x: -1, y: 0.5, z: 0 }], vias: [] }
  const wall: HighDensityRoute = { ...fixed, route: [{ x: -1, y: -1, z: 0 }, { x: -1, y: 3, z: 0 }] }
  const moved = structuredClone(nodes)
  for (const node of moved) {
    node.portPoints[1]!.y = 0.6749979
    node.portPointsInPairs![0]![1].y = 0.6749979
  }
  const node = normalizeBoundaryNodeRoots(moved[0]!, connMap)
  const interfacePortPoints = createBoundaryInterfaceIndex(moved, rules, connMap).ports
  const common = { ...rules, node, connMap, interfacePolicy: "owned-normal-escapes" as const, interfacePortPoints }
  const conflicts = (route: HighDensityRoute, obstacle: HighDensityRoute): boolean => doPipeline9RoutesHaveCopperConflict({ left: route, right: obstacle, clearance: 0.150001, layerCount: 2 })
  const candidates: HighDensityRoute[] = []
  const eligible = constructPipeline9ParametricCell({ ...common, isCompatibleWithMandatoryCopper: (route): boolean => {
    candidates.push(route)
    return !conflicts(route, fixed)
  } })
  expect(candidates.some((route) => conflicts(route, fixed))).toBe(true)
  expect(candidates.some((route) => !conflicts(route, fixed))).toBe(true)
  const routeLength = (route: HighDensityRoute): number => route.route.reduce((sum, point, index, all) => sum + (index === 0 ? 0 : Math.hypot(point.x - all[index - 1]!.x, point.y - all[index - 1]!.y)), 0)
  const unsafeLength = Math.min(...candidates.filter((route) => conflicts(route, fixed)).map(routeLength))
  const safeLength = Math.min(...candidates.filter((route) => !conflicts(route, fixed)).map(routeLength))
  expect(unsafeLength).toBeCloseTo(safeLength, 12)
  expect(eligible.applicable).toBe(true)
  expect(conflicts(eligible.routes[0]!, fixed)).toBe(false)
  expect(eligible.stats.parametricMandatoryCopperChecks).toBe(candidates.length)
  expect(eligible.stats.parametricMandatoryCopperRejections).toBeGreaterThan(0)
  const blocked = constructPipeline9ParametricCell({ ...common, isCompatibleWithMandatoryCopper: (route): boolean => !conflicts(route, wall) })
  expect(blocked.applicable).toBe(false)
  expect(blocked.routes).toEqual([])
  expect(blocked.stats.parametricMandatoryCopperRejections).toBe(blocked.stats.parametricMandatoryCopperChecks)
  expect(constructPipeline9ParametricCell(common).applicable).toBe(true)
  expect(constructPipeline9ParametricCell({ ...common, isCompatibleWithMandatoryCopper: (route): boolean => !conflicts(route, fixed) }).applicable).toBe(true)
  for (const [obstacle, expectedRollbacks, expectedCells] of [[fixed, 0, 2], [wall, 1, 0]] as const) {
    const distribution = new UniformPortDistributionSolver({ nodeWithPortPoints: nodes, inputNodesWithPortPoints: inputNodes, obstacles: rules.obstacles, layerCount: 2 })
    distribution.solve()
    const solver = new Pipeline9CertifiedBoundarySolver({ distribution, inputNodesWithPortPoints: inputNodes, ...rules, clearance: 0.15, hasPreloadedCopper: true, connMap, rules, fixedHdRoutes: [obstacle], immutableConnectionNames: new Set() })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.boundaryProofMovedPorts).toBe(1)
    expect(solver.stats.boundaryProofRollbacks).toBe(expectedRollbacks)
    expect(solver.stats.boundaryProofRetainedMovedPorts).toBe(1 - expectedRollbacks)
    expect(solver.stats.boundaryProofCellCount).toBe(expectedCells)
    expect(solver.stats.parametricMandatoryCopperRejections).toBeGreaterThan(0)
    for (const certificate of Object.values(solver.certificates.cells)) for (const route of certificate.routes) expect(conflicts(route, obstacle)).toBe(false)
  }
})
