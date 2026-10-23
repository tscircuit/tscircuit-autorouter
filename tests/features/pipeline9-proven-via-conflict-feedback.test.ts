import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { ProvenViaConflictOracle, getProvenViaConflictContext } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/ProvenViaConflictOracle"

test("lazy via conflict learns a sound cut, reuses it, and finds a legal global alternative", () => {
  const region = { center: { x: 0, y: 0 }, width: 2, height: 2 }
  const obstacle = { type: "rect" as const, center: { x: 0, y: 0 }, width: 2.2, height: 2.2, layers: ["inner1"], connectedTo: [] }
  const context = { layerCount: 4, obstacles: [obstacle], viaDiameter: 0.3, clearance: 0.15, allowBlindAndBuriedVias: false }
  const oracle = new ProvenViaConflictOracle(context)
  expect(oracle.stats.learnedViaRegionCuts).toBe(0)
  expect(oracle.rejectsTransition(region, 0, 0)).toBe(false)
  expect(oracle.rejectsTransition(region, 0, 3)).toBe(true)
  expect(oracle.rejectsTransition(region, 3, 0)).toBe(true)
  expect(oracle.stats.learnedViaRegionCuts).toBe(1)
  expect(oracle.stats.reusedViaRegionCuts).toBe(1)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, netIsAssignable: true }] }).rejectsTransition(region, 0, 3)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, allowBlindAndBuriedVias: true }).rejectsTransition(region, 0, 1)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, ccwRotationDegrees: 45 }] }).rejectsTransition(region, 0, 3)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, shape: "circle" }] }).rejectsTransition(region, 0, 3)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, connectedTo: ["same-net"] }] }).rejectsTransition(region, 0, 3)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, width: 0.2, height: 0.2 }] }).rejectsTransition({ center: { x: 0.39, y: 0.39 }, width: 0.01, height: 0.01 }, 0, 3)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, isCopperPour: true }] }).rejectsTransition(region, 0, 3)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, __zLayers: [] }] }).rejectsTransition(region, 0, 3)).toBe(false)
  expect(new ProvenViaConflictOracle({ ...context, obstacles: [{ ...obstacle, zLayers: [] }] }).rejectsTransition(region, 0, 3)).toBe(false)
  const keepoutContext = getProvenViaConflictContext({ layerCount: 4, minTraceWidth: 0.1, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections: [], obstacles: [{ ...obstacle, width: 0.2, height: 0.2 }], defaultObstacleMargin: 0.01, minViaEdgeToPadEdgeClearance: 1 }, 0.3)
  expect(keepoutContext.clearance).toBe(0.01)
  expect(new ProvenViaConflictOracle(keepoutContext).rejectsTransition({ center: { x: 0.4, y: 0 }, width: 0.01, height: 0.01 }, 0, 3)).toBe(false)
  const topology: TinyHyperGraphTopology = {
    portCount: 4, regionCount: 2,
    regionIncidentPorts: [[0, 1, 2, 3], [1, 2]], incidentPortRegion: [[0], [0, 1], [0, 1], [0]],
    regionWidth: new Float64Array([2, 4]), regionHeight: new Float64Array([2, 2]), regionCenterX: new Float64Array([0, 3]), regionCenterY: new Float64Array([0, 0]),
    regionAvailableZMask: new Int32Array([9, 9]), regionMetadata: [region, { center: { x: 3, y: 0 }, width: 4, height: 2 }],
    portAngleForRegion1: new Int32Array([18000, 3000, 33000, 0]), portAngleForRegion2: new Int32Array([0, 15000, 21000, 0]),
    portX: new Float64Array([-1, 1, 1, 0]), portY: new Float64Array([0, 0.5, -0.5, 0]), portZ: new Int32Array([0, 0, 3, 3]),
  }
  const solver = new TinyHyperGraphSolver(topology, { routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([3]), routeNet: new Int32Array([0]), regionNetId: new Int32Array([-1, -1]), portSectionMask: new Int8Array([1, 1, 1, 1]) })
  oracle.install(solver)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments[1]!.length).toBeGreaterThan(0)
  for (const [, from, to] of solver.state.regionSegments[0]!) expect(topology.portZ[from]).toBe(topology.portZ[to])
})
