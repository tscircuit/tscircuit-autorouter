import { expect, test } from "bun:test"
import type { TinyHyperGraphTopology, TinyHyperGraphProblem } from "tiny-hypergraph/lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { PackedDistanceAwareTinyHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedDistanceAwareTinyHyperGraphSolver"

function fixture(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  const count = 74
  const incidentPortRegion = Array.from({ length: count }, (_, port) => port < 36 ? [0, 1] : port < 72 ? [1, 2] : port === 72 ? [3, 0] : [2, 4])
  return {
    topology: { regionCount: 5, portCount: count, incidentPortRegion,
      regionIncidentPorts: Array.from({ length: 5 }, (_, region) => Array.from({ length: count }, (_, port) => port).filter((port) => incidentPortRegion[port]!.includes(region))),
      regionWidth: new Float64Array([2, 2, 2, 0.1, 0.1]), regionHeight: new Float64Array([4, 4, 4, 0.1, 0.1]),
      regionCenterX: new Float64Array([0, 2, 4, -1, 5]), regionCenterY: new Float64Array(5),
      regionAvailableZMask: new Int32Array([3, 3, 3, 1, 1]),
      portX: Float64Array.from({ length: count }, (_, port) => port < 36 ? 1 : port < 72 ? 3 : port === 72 ? -1 : 5),
      portY: Float64Array.from({ length: count }, (_, port) => port < 72 ? (port % 36) / 12 - 1.5 : 0),
      portZ: Int32Array.from({ length: count }, (_, port) => port % 2),
      portAngleForRegion1: Int32Array.from({ length: count }, (_, port) => port * 431 % 36000),
      portAngleForRegion2: Int32Array.from({ length: count }, (_, port) => (port * 431 + 18000) % 36000),
    },
    problem: { routeCount: 1, routeStartPort: new Int32Array([72]), routeEndPort: new Int32Array([73]),
      routeNet: new Int32Array([0]), regionNetId: new Int32Array(5).fill(-1), portSectionMask: new Int8Array(count).fill(1) },
  }
}

test("cached routing retains native cap, goal order, costs and queues while coordinates mutate, restore and arrays change", (): void => {
  for (let seed = 0; seed < 8; seed++) {
    const input = fixture()
    const options = { MAX_ITERATIONS: 160, STATIC_REACHABILITY_PRECHECK: false,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, RIP_THRESHOLD_RAMP_ATTEMPTS: 0 }
    const native = new DistanceAwareTinyHyperGraphSolver(structuredClone(input.topology), structuredClone(input.problem), options)
    const packed = new PackedDistanceAwareTinyHyperGraphSolver(structuredClone(input.topology), structuredClone(input.problem), options)
    while (!native.solved && !native.failed) {
      const iteration = native.iterations
      if (iteration > 0 && iteration % 3 === 0) {
        const port = (iteration * 13 + seed) % 72
        for (const solver of [native, packed]) {
          solver.topology.portX[port] += (iteration % 2 ? 1 : -1) * 0.0625
          solver.topology.portY[port] = iteration % 9 === 0 ? -0 : input.topology.portY[port]!
          if (iteration % 15 === 0) solver.topology.portX[port] = input.topology.portX[port]!
          if (iteration % 12 === 0) { solver.topology.portX = solver.topology.portX.slice(); solver.topology.portY = solver.topology.portY.slice() }
        }
      }
      native.step(); packed.step()
      expect(packed.solved).toBe(native.solved)
      expect(packed.failed).toBe(native.failed)
      expect(packed.iterations).toBe(native.iterations)
      const { candidateQueue: nativeQueue, ...nativeState } = native.state
      const { candidateQueue: packedQueue, ...packedState } = packed.state
      expect(packedState).toEqual(nativeState)
      expect(packedQueue.toArray()).toEqual(nativeQueue.toArray())
    }
  }
})
