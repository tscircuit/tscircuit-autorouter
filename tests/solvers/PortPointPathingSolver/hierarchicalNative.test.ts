import { expect, test } from 'bun:test'
import { TinyHyperGraphSolver, type TinyHyperGraphTopology, type TinyHyperGraphProblem } from 'tiny-hypergraph/lib/core'
import { createHierarchicalPortController } from '../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/installHierarchicalPortPotential'

test('native hierarchy honors free goal region, partial endpoint changes, memo and original solver caps', (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 6, regionCount: 5, regionIncidentPorts: [[0,1],[1,2],[2,3],[3,4],[4,5]],
    incidentPortRegion: [[0],[0,1],[1,2],[2,3],[3,4],[4]],
    regionWidth: new Float64Array(5).fill(3), regionHeight: new Float64Array(5).fill(3),
    regionCenterX: new Float64Array([0,1,1,0,0]), regionCenterY: new Float64Array([0,1,2,2,0]),
    portAngleForRegion1: new Int32Array(6), portX: new Float64Array([0,1,1,0,0,0.1]),
    portY: new Float64Array([0,0,2,2,0.2,0]), portZ: new Int32Array(6),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1, portSectionMask: new Int8Array(6).fill(1), routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([5]), routeNet: new Int32Array([0]), regionNetId: new Int32Array(5).fill(-1),
  }
  class EndpointSolver extends TinyHyperGraphSolver {
    end = 5
    override getRouteEndPortId(_route: number): number { return this.end }
  }
  const host = new EndpointSolver(topology, problem, { MAX_ITERATIONS: 100, DISTANCE_TO_COST: 1, OWNED_REGIONAL_HOP_FRONTIER: true })
  const controller = createHierarchicalPortController(), originalH = host.computeH.bind(host)
  controller.install(host)
  host.step()
  host.state.currentRouteId = 0
  expect(host.MAX_ITERATIONS).toBe(100)
  const proposed = host.computeH(0)
  expect(proposed).toBeGreaterThan(originalH(0))
  expect(controller.diagnostics.strengthenedQueries).toBeGreaterThan(0)
  expect(host.computeH(0)).toBe(proposed)
  expect(controller.diagnostics.heuristicMemoHits).toBeGreaterThan(0)
  // Free native completion inside terminal region makes port4 a zero relaxed
  // distance to the goal set, while existing native Euclidean guidance remains.
  expect(host.computeH(4)).toBe(originalH(4))
  host.end = 1
  expect(host.computeH(0)).toBe(originalH(0))
  expect(controller.diagnostics.goalChanges).toBeGreaterThan(1)
  expect(controller.diagnostics.setupWorkUnits).toBeGreaterThan(0)
  expect(controller.diagnostics.nativeIterations).toBe(1)
  expect(controller.diagnostics.landmarkFields).toBe(2)
  expect(controller.diagnostics.eliminatedVertices).toBeGreaterThan(0)
})
