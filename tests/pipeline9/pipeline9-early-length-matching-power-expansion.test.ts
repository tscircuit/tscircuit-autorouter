import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 keeps length-matched copper fixed when explicitly selected for power expansion", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    powerTraceExpansion: { onlyConnectionNames: ["a", "b"] },
  })
  solver.solveUntilPhase("componentDetectionSolver")
  const earlyTraces = structuredClone(
    solver.srj.traces!.filter((trace): boolean =>
      ["a", "b"].includes(trace.connection_name),
    ),
  )
  expect(earlyTraces).toHaveLength(2)

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const expansionInput = solver.powerTraceExpansionSolver!
    .inputSrj as SimpleRouteJson & { fixedTraces: SimplifiedPcbTraces }
  for (const earlyTrace of earlyTraces) {
    expect(expansionInput.fixedTraces).toContainEqual(earlyTrace)
    expect(expansionInput.traces).not.toContainEqual(earlyTrace)
    expect(solver.getOutputSimplifiedPcbTraces()).toContainEqual(earlyTrace)
    expect(solver.getOutputSimpleRouteJson().traces).toContainEqual(earlyTrace)
  }
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(2)
})
