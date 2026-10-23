import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { ParallelSelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/parallel-selective-rerip-tiny-hypergraph-solver"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

type PortInternals = {
  params: HgPortPointPathingSolverParams
  tinyPipelineSolver: { activeSubSolver?: unknown }
}

const initialNativeSolver = (
  port: TinyHypergraphPortPointPathingSolver,
): unknown => {
  port.step()
  return (port as unknown as PortInternals).tinyPipelineSolver.activeSubSolver
}

test("Pipeline9 enables parallel native search for fresh unconstrained boards", async (): Promise<void> => {
  for (const mode of ["fresh", "preloaded", "length-matched"] as const) {
    const input = createPipeline9LengthMatchingPreloadedInput(-2)
    if (mode !== "preloaded") input.traces = []
    if (mode !== "length-matched") input.buses = []
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    pipeline.solveUntilPhase("portPointPathingSolver")
    if (!pipeline.portPointPathingSolver) pipeline.step()
    expect(pipeline.failed).toBe(false)
    const port = pipeline.portPointPathingSolver!
    const solver = initialNativeSolver(port)
    expect(solver instanceof ParallelSelectiveReripTinyHyperGraphSolver).toBe(
      mode === "fresh",
    )
    if (mode === "fresh") {
      // Pipeline7 and direct callers retain the established default policy.
      const legacy = new TinyHypergraphPortPointPathingSolver(
        (port as unknown as PortInternals).params,
      )
      expect(
        initialNativeSolver(legacy) instanceof
          ParallelSelectiveReripTinyHyperGraphSolver,
      ).toBe(false)
    }
  }
  for (let sampleNumber = 1; sampleNumber <= 16; sampleNumber++) {
    const { scenario } = await loadScenarioBySampleNumber("srj18", sampleNumber)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      scenario,
      { cacheProvider: null },
    )
    pipeline.solveUntilPhase("portPointPathingSolver")
    if (!pipeline.portPointPathingSolver) pipeline.step()
    expect(pipeline.failed).toBe(false)
    expect(
      initialNativeSolver(pipeline.portPointPathingSolver!) instanceof
        ParallelSelectiveReripTinyHyperGraphSolver,
    ).toBe(true)
  }
})
