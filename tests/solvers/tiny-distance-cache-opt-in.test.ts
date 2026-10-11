import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { PackedDistanceAwareTinyHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedDistanceAwareTinyHyperGraphSolver"
import { TinyTriangularDistanceIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyTriangularDistanceIndex"

test("packed pathing uses direct native distance math by default and retains exact explicit cache opt-in", (): void => {
  const graph: SerializedHyperGraph = {
    regions: Array.from({ length: 3 }, (_, region) => ({
      regionId: `r${region}`, pointIds: [],
      d: { center: { x: 2 * region, y: 0 }, width: 2, height: 3, availableZ: [0, 1] },
    })),
    ports: [], connections: [{ connectionId: "route", mutuallyConnectedNetworkId: "net", startRegionId: "r0", endRegionId: "r2" }],
  }
  for (let region = 0; region < 2; region++) {
    for (let port = 0; port < 4; port++) {
      const portId = `p${region}:${port}`
      graph.ports.push({ portId, region1Id: `r${region}`, region2Id: `r${region + 1}`,
        d: { x: 2 * region + 1, y: port / 2 - 0.75, z: port % 2 } })
      graph.regions[region]!.pointIds.push(portId)
      graph.regions[region + 1]!.pointIds.push(portId)
    }
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  const options = { MAX_ITERATIONS: 1_000, STATIC_REACHABILITY_PRECHECK: false, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false }
  const factory = TinyTriangularDistanceIndex.forTopology
  let preparations = 0
  TinyTriangularDistanceIndex.forTopology = (...args) => {
    preparations++
    return factory.call(TinyTriangularDistanceIndex, ...args)
  }
  try {
    const native = new DistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem), options)
    const direct = new PackedDistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem), options)
    const disabled = new PackedDistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem),
      { ...options, enableTriangularDistanceCache: false })
    expect(preparations).toBe(0)
    const cached = new PackedDistanceAwareTinyHyperGraphSolver(structuredClone(topology), structuredClone(problem),
      { ...options, enableTriangularDistanceCache: true })
    expect(preparations).toBe(1)
    expect((cached as unknown as { distanceIndex?: TinyTriangularDistanceIndex }).distanceIndex)
      .toBeInstanceOf(TinyTriangularDistanceIndex)
    while (!native.solved && !native.failed) {
      native.step()
      const { candidateQueue: nativeQueue, ...nativeState } = native.state
      for (const solver of [direct, disabled, cached]) {
        solver.step()
        expect(solver.solved).toBe(native.solved)
        expect(solver.failed).toBe(native.failed)
        expect(solver.iterations).toBe(native.iterations)
        const { candidateQueue, ...state } = solver.state
        expect(state).toEqual(nativeState)
        expect(candidateQueue.toArray()).toEqual(nativeQueue.toArray())
      }
    }
    expect(native.solved).toBe(true)
    expect(preparations).toBe(1)
  } finally {
    TinyTriangularDistanceIndex.forTopology = factory
  }
})
