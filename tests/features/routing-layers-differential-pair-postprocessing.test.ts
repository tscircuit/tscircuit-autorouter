import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"

test("Pipelines 7 and 9 preserve routed pairs when layer-changing postprocessing cannot honor routingLayers", () => {
  const input = {
    layerCount: 2,
    routingLayers: ["top"],
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [],
  } satisfies SimpleRouteJson
  const solvers = [
    new AutoroutingPipelineSolver7_MultiGraph(structuredClone(input), {
      cacheProvider: null,
    }),
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), {
      cacheProvider: null,
    }),
  ]

  for (const solver of solvers) {
    const stepIndex = solver.pipelineDef.findIndex(
      (step) => step.solverName === "lengthMatchingPostProcessingSolver",
    )
    const step = solver.pipelineDef[stepIndex]!
    expect(() => step.getConstructorParams(solver as never)).toThrow(
      "Differential-pair post-processing cannot run when routingLayers excludes board layers",
    )

    solver.currentPipelineStepIndex = stepIndex
    solver.step()
    expect(solver.currentPipelineStepIndex).toBe(stepIndex + 1)
    expect(solver.lengthMatchingPostProcessingSolver).toBeUndefined()
    expect(
      solver.stats.lengthMatchingPostProcessingSkippedForRoutingLayers,
    ).toBe(true)
  }
})
