import { expect, test } from "bun:test"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"
import { CostConsistentTinyHyperGraphSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/cost-consistent-tiny-hypergraph-solver"
import { IndexedCandidateHeap } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/indexed-candidate-heap"

test("decreases a queued hop in place and accumulates XY distance in g", () => {
  const heap = new IndexedCandidateHeap(2)
  heap.queue({ portId: 0, nextRegionId: 0, f: 10, g: 10, h: 0 })
  heap.queue({ portId: 1, nextRegionId: 0, f: 6, g: 6, h: 0 })
  heap.queue({ portId: 0, nextRegionId: 0, f: 4, g: 4, h: 0 })
  heap.queue({ portId: 0, nextRegionId: 0, f: 8, g: 8, h: 0 })

  expect(heap.length).toBe(2)
  expect(heap.dequeue()?.g).toBe(4)
  expect(heap.dequeue()?.g).toBe(6)
  expect(heap.dequeue()).toBeUndefined()

  heap.queue({ portId: 0, nextRegionId: 0, f: 3, g: 3, h: 0 })
  expect(heap.length).toBe(0)

  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 1,
    regionIncidentPorts: [[0, 1]],
    incidentPortRegion: [[0], [0]],
    regionWidth: new Float64Array([10]),
    regionHeight: new Float64Array([10]),
    regionCenterX: new Float64Array([1.5]),
    regionCenterY: new Float64Array([2]),
    regionAvailableZMask: new Int32Array([1]),
    portAngleForRegion1: new Int32Array([18000, 0]),
    portAngleForRegion2: new Int32Array([0, 0]),
    portX: new Float64Array([0, 3]),
    portY: new Float64Array([0, 4]),
    portZ: new Int32Array([0, 0]),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1]),
  }
  const candidate = { portId: 0, nextRegionId: 0, f: 7, g: 7, h: 0 }
  const baseSolver = new TinyHyperGraphSolver(topology, problem)
  const solver = new CostConsistentTinyHyperGraphSolver(topology, problem)
  baseSolver.state.currentRouteNetId = 0
  solver.state.currentRouteNetId = 0

  const baseCost = baseSolver.computeG(candidate, 1)
  expect(solver.computeG(candidate, 1)).toBeCloseTo(baseCost + 5 * 0.05)
})
