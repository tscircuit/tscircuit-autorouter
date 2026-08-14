import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test(
  "Pipeline7 repairs SRJ18 sample 3 against the original rotated pad geometry",
  async () => {
    const { scenario } = await loadScenarioBySampleNumber("srj18", 3)
    const pipeline = new AutoroutingPipelineSolver7_MultiGraph(scenario, {
      cacheProvider: null,
    })

    pipeline.solveUntilPhase("exactGeometryDrcForceImproveSolver")
    const beforeExact = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: pipeline.srjWithPointPairs!,
      routedTraces: pipeline.getPrePowerTraceOutputSimplifiedPcbTraces(),
    })

    expect(
      beforeExact.errors.some(
        (error) =>
          "pcb_pad_id" in error &&
          error.pcb_pad_id === "pcb_smtpad_56" &&
          "pcb_trace_id" in error &&
          error.pcb_trace_id === "source_trace_26__source_net_26_mst3_0",
      ),
    ).toBe(true)

    pipeline.solve()
    const afterExact = evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: pipeline.srjWithPointPairs!,
      routedTraces: pipeline.getOutputSimplifiedPcbTraces(),
    })

    expect(pipeline.failed).toBe(false)
    expect(pipeline.solved).toBe(true)
    expect(afterExact.errors).toEqual([])
  },
  { timeout: 120_000 },
)
