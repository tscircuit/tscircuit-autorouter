import { expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver4_TinyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver6_PolyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver8 } from "lib/autorouter-pipelines/AutoroutingPipeline8/AutoroutingPipelineSolver8"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import * as connectivity from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { existingPlaneVias } from "tests/fixtures/existing-plane-vias"

test("escape stages reuse the preprocessed pipeline connectivity map", (): void => {
  for (const Pipeline of [
    AutoroutingPipelineSolver4_TinyHypergraph,
    AutoroutingPipelineSolver6_PolyHypergraph,
    AutoroutingPipelineSolver7_MultiGraph,
    AutoroutingPipelineSolver8,
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ]) {
    const pipeline = new Pipeline(structuredClone(existingPlaneVias), {
      cacheProvider: null,
    })
    while (
      pipeline.getCurrentPhase() !== "escapeViaLocationSolver" &&
      !pipeline.solved &&
      !pipeline.failed
    ) {
      pipeline.step()
    }
    expect(pipeline.getCurrentPhase()).toBe("escapeViaLocationSolver")
    const standalone = new EscapeViaLocationSolver(pipeline.srj)
    standalone.solve()
    expect(standalone.solved).toBeTrue()

    const buildMap = spyOn(
      connectivity,
      "getConnectivityMapFromSimpleRouteJson",
    )
    try {
      while (
        !pipeline.escapeViaLocationSolver?.solved &&
        !pipeline.solved &&
        !pipeline.failed
      ) {
        pipeline.step()
      }
      expect(pipeline.failed).toBeFalse()
      expect(pipeline.escapeViaLocationSolver?.solved).toBeTrue()
      expect(buildMap).not.toHaveBeenCalled()
      expect(
        pipeline.escapeViaLocationSolver!.getOutputSimpleRouteJson(),
      ).toEqual(standalone.getOutputSimpleRouteJson())
    } finally {
      buildMap.mockRestore()
    }
  }
})
