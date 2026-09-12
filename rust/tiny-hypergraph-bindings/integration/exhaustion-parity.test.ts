import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { importReference } from "../../autorouter-bindings/integration/tsReference"
import type { LoadedHyperGraph, TinyHyperGraphTopology, TinyHyperGraphProblem, TinyHyperGraphSolverOptions } from "../ts/index"
import { TinyHypergraphPipelineAdapter } from "../../../lib/bindings/tiny-hypergraph/TinyHypergraphPipelineAdapter"

type ReferenceSolver = {
  solved: boolean
  failed: boolean
  error: string | null
  iterations: number
  solve(): void
}
type ReferenceConstructor = new (topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, options: TinyHyperGraphSolverOptions) => ReferenceSolver

const { TinyHyperGraphSolver, loadSerializedHyperGraph } = await importReference<{
  TinyHyperGraphSolver: ReferenceConstructor
  loadSerializedHyperGraph(graph: SerializedHyperGraph): LoadedHyperGraph
}>("node_modules/tiny-hypergraph/lib/index.ts")
const { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } = await importReference<{
  SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments: ReferenceConstructor
}>("lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments.ts")

test("tiny pipeline preserves reference exhaustion status, error and search iterations", () => {
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
    connections: [
      { connectionId: "net1", startRegionId: "west", endRegionId: "east" },
      { connectionId: "net2", startRegionId: "west", endRegionId: "east" },
    ],
  }
  for (const selective of [false, true]) {
    const options = { MAX_ITERATIONS: 1, RIP_THRESHOLD_RAMP_ATTEMPTS: 5 }
    const loaded = loadSerializedHyperGraph(graph)
    const Constructor = selective ? SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments : TinyHyperGraphSolver
    const expected = new Constructor(loaded.topology, loaded.problem, options)
    expected.solve()
    const actual = new TinyHypergraphPipelineAdapter({ serializedHyperGraph: graph, solveGraphOptions: options }, selective, () => ({
      duplicatePortPenaltyCount: 0, metadataPortPenaltyCount: 0, crampedPortPenaltyCount: 0,
      preloadedPortCount: 0, preloadedFixedSegmentCount: 0, crampedPortTraversalPenalty: 0,
    }))
    actual.solve()
    expect(expected.failed).toBe(true)
    expect(actual.failed).toBe(expected.failed)
    expect(actual.solved).toBe(expected.solved)
    expect(actual.error).toBe(expected.error)
    expect(actual.solveGraph.iterations).toBe(expected.iterations)
    actual.step()
    expect(actual.error).toBe(expected.error)
  }
})
