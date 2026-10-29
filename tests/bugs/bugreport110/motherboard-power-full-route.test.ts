import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadMotherboardPowerPhase } from "../../../fixtures/bug-reports/bugreport110-motherboard-power-phase/repro"

test("preserves the complete motherboard power-phase routing output", (): void => {
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    loadMotherboardPowerPhase(),
    { effort: 1, cacheProvider: null },
  )
  pipeline.solve()
  expect(pipeline.failed).toBe(false)
  expect(pipeline.solved).toBe(true)
  // Captured from the complete, unoptimized run, including power expansion.
  // Covers all copper geometry, layers, widths, vias and replacement metadata.
  expect(
    createHash("sha256")
      .update(JSON.stringify(pipeline.getOutputSimpleRouteJson()))
      .digest("hex"),
  ).toBe("5c90f0d5e4bd73b4aed32d62e1f4350e5df0f36a70c53d47a2a79d714d7ab974")
})
