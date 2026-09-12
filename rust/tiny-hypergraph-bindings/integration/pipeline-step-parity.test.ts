import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { importReference } from "../../autorouter-bindings/integration/tsReference"
import { TinyHypergraphPipelineAdapter } from "../../../lib/bindings/tiny-hypergraph/TinyHypergraphPipelineAdapter"
import type { TinyHypergraphRoutingInput } from "../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/tinyHypergraphTypes"
import type { TinyHyperGraphSectionPipelineSolver } from "tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver"

const { TinyHyperGraphSectionPipelineSolver: Reference } = await importReference<{
  TinyHyperGraphSectionPipelineSolver: typeof TinyHyperGraphSectionPipelineSolver
}>("node_modules/tiny-hypergraph/lib/section-solver/TinyHyperGraphSectionPipelineSolver.ts")

test("empty-section pipeline preserves each public search, transition and terminal step", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      { regionId: "west", pointIds: ["p0"], d: { width: 1, height: 1 } },
      { regionId: "middle", pointIds: ["p0", "p1"], d: { width: 2, height: 2 } },
      { regionId: "east", pointIds: ["p1"], d: { width: 1, height: 1 } },
    ],
    ports: [
      { portId: "p0", region1Id: "middle", region2Id: "west", d: { x: -1, y: 0, z: 0 } },
      { portId: "p1", region1Id: "middle", region2Id: "east", d: { x: 1, y: 0, z: 0 } },
    ],
    connections: [{ connectionId: "net1", startRegionId: "west", endRegionId: "east" }],
  }
  for (const maxIterations of [1, 100]) {
    const input: TinyHypergraphRoutingInput = {
      serializedHyperGraph: graph, solveGraphOptions: { MAX_ITERATIONS: maxIterations },
    }
    const actual = new TinyHypergraphPipelineAdapter(input, false, () => ({
      duplicatePortPenaltyCount: 0, metadataPortPenaltyCount: 0, crampedPortPenaltyCount: 0,
      preloadedPortCount: 0, preloadedFixedSegmentCount: 0, crampedPortTraversalPenalty: 0,
    }))
    const expected = new Reference({ ...input, createSectionMask: ({ topology }) => new Int8Array(topology.portCount) })
    expected.MAX_ITERATIONS = actual.MAX_ITERATIONS
    let retainedActual: unknown, retainedExpected: unknown
    for (let step = 0; step < 110; step++) {
      for (const field of ["iterations", "solved", "failed", "error", "progress", "currentPipelineStageIndex"] as const) {
        expect(actual[field], `step ${step} ${field}`).toEqual(expected[field])
      }
      expect(actual.getCurrentStageName()).toBe(expected.getCurrentStageName())
      const referenceSearch = expected.getSolver<any>("solveGraph")
      expect(Boolean(actual.solveGraph)).toBe(Boolean(referenceSearch))
      if (actual.solveGraph && referenceSearch) {
        retainedActual ??= actual.solveGraph
        retainedExpected ??= referenceSearch
        expect(actual.solveGraph).toBe(retainedActual)
        expect(referenceSearch).toBe(retainedExpected)
        expect(actual.solveGraph.iterations).toBe(referenceSearch.iterations)
        expect(actual.solveGraph.state.regionSegments).toEqual(referenceSearch.state.regionSegments)
        expect(actual.solveGraph.stats).toEqual(referenceSearch.stats)
      }
      expect(actual.getOutput()).toEqual(expected.getOutput())
      if (expected.solved || expected.failed) break
      actual.step()
      expected.step()
    }
    expect(actual.solved || actual.failed).toBe(true)
    const before = actual.iterations
    actual.step()
    expect(actual.iterations).toBe(before)
  }
})
