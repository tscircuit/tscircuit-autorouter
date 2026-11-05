import { expect, test } from "bun:test"
import sample021 from "@tscircuit/dataset-srj24/samples/sample021.json"
import sample022 from "@tscircuit/dataset-srj24/samples/sample022.json"
import sample023 from "@tscircuit/dataset-srj24/samples/sample023.json"
import sample025 from "@tscircuit/dataset-srj24/samples/sample025.json"
import sample026 from "@tscircuit/dataset-srj24/samples/sample026.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("SRJ24 copper-connected samples retain clean final routing and clearance", () => {
  for (const sample of [sample021, sample022, sample023, sample025, sample026]) {
    const input = structuredClone(sample) as SimpleRouteJson
    const original = structuredClone(input)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const { errors } = evaluateRelaxedDrc({
      inputSrj: original,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    })
    expect(errors).toEqual([])
  }
})
