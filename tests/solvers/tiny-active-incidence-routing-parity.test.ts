import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { PackedDistanceAwareTinyHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedDistanceAwareTinyHyperGraphSolver"

type SearchCounters = { routeAttemptCountByRouteId: Uint32Array; routeSuccessCountByRouteId: Uint32Array }

function fixture(seed: number): SerializedHyperGraph {
  let randomState = seed + 29
  const random = (): number => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296 }
  const regions: SerializedHyperGraph["regions"] = Array.from({ length: 6 }, (_, region) => ({
    regionId: `r${region}`, pointIds: [], d: { center: { x: region * 2, y: 0 }, width: 2, height: 3, availableZ: [0, 1] },
  }))
  const ports: SerializedHyperGraph["ports"] = []
  for (let region = 0; region < 5; region++) {
    for (let port = 0; port < 15 + seed % 9; port++) {
      const portId = `p${region}:${port}`
      ports.push({ portId, region1Id: `r${region}`, region2Id: `r${region + 1}`,
        d: { x: region * 2 + 1, y: random() * 2 - 1, z: port % 2, tinyHypergraphPortPenalty: random() * 0.3 } })
      regions[region]!.pointIds.push(portId)
      regions[region + 1]!.pointIds.push(portId)
    }
  }
  return { regions, ports, connections: Array.from({ length: 3 }, (_, route) => ({
    connectionId: `route${route}`, mutuallyConnectedNetworkId: `net${route}`,
    startRegionId: "r0", endRegionId: "r5",
  })) }
}

test("active incidence routing keeps native queues and states after mutable masks, occupancy, clearing and rerips", (): void => {
  let observedRip = false
  for (let seed = 0; seed < 12; seed++) {
    const loaded = loadSerializedHyperGraph(fixture(seed))
    const options = { MAX_ITERATIONS: 900, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      STATIC_REACHABILITY_PRECHECK: false, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, minViaPadDiameter: 0.3 }
    const native = new DistanceAwareTinyHyperGraphSolver(structuredClone(loaded.topology), structuredClone(loaded.problem), options)
    const packed = new PackedDistanceAwareTinyHyperGraphSolver(structuredClone(loaded.topology), structuredClone(loaded.problem), options)
    while (!native.solved && !native.failed) {
      if (native.iterations > 0 && native.iterations % 47 === 0) {
        const port = (native.iterations * 13) % loaded.topology.portCount
        for (const solver of [native, packed]) {
          solver.problem.portSectionMask[port] ^= 1
          solver.state.portAssignment[port] = solver.state.portAssignment[port] === -1 ? 8 : -1
          solver.problem.regionNetId[2] = solver.problem.regionNetId[2] === -1 ? 8 : -1
        }
      }
      if (native.iterations > 0 && native.iterations % 151 === 0) {
        native.state.candidateQueue.clear()
        packed.state.candidateQueue.clear()
      }
      if (native.iterations > 0 && native.iterations % 211 === 0) {
        for (const solver of [native, packed]) (solver as unknown as { _setup(): void })._setup()
      }
      native.step(); packed.step()
      expect(packed.solved).toBe(native.solved)
      expect(packed.failed).toBe(native.failed)
      expect(packed.error?.replace(packed.constructor.name, "Solver"))
        .toBe(native.error?.replace(native.constructor.name, "Solver"))
      expect(packed.iterations).toBe(native.iterations)
      const actualCounters = packed as unknown as SearchCounters
      const expectedCounters = native as unknown as SearchCounters
      expect(actualCounters.routeAttemptCountByRouteId).toEqual(expectedCounters.routeAttemptCountByRouteId)
      expect(actualCounters.routeSuccessCountByRouteId).toEqual(expectedCounters.routeSuccessCountByRouteId)
      const { candidateQueue: expectedQueue, ...expected } = native.state
      const { candidateQueue: actualQueue, ...actual } = packed.state
      expect(actual).toEqual(expected)
      expect(actualQueue.toArray()).toEqual(expectedQueue.toArray())
      observedRip ||= native.state.ripCount > 0
    }
  }
  expect(observedRip).toBe(true)
})
