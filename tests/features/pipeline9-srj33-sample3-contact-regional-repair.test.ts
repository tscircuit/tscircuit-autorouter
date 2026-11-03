import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves regional repair for contacts left by a completed exact portfolio", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj33", 3)
  const solver: AutoroutingPipelineSolver9_PreloadedTraceGraph =
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      { cacheProvider: null, effort: 1 },
    )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  // The baseline routes have four issues: endpoint geometry used to hide the
  // lower pad contact beneath source_net_5's top-layer terminal.
  expect(errors.length).toBeLessThanOrEqual(4)
  let viaCount: number = 0
  for (const trace of routedTraces) {
    for (const point of trace.route) {
      if (point.route_type === "via") viaCount++
    }
  }
  expect(viaCount).toBeLessThanOrEqual(114)
  const output = solver.getOutputSimpleRouteJson()
  const circuitJson = convertToCircuitJson(output, output.traces!, {
    originalSrj: scenario,
    includeOriginalConnections: true,
    minTraceWidth: scenario.minTraceWidth,
    minViaDiameter: scenario.minViaDiameter,
  })
  expect(checkViasInPads(circuitJson)).toEqual([])
})
