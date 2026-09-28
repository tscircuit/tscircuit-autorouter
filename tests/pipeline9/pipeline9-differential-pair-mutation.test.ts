import { expect, test } from "bun:test"
import type { Pipeline7PowerTraceExpansionInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"
import fixture from "../fixtures/core-differential-pair-pad-clearance.json"

test("Pipeline9 rejects downstream mutation of a finished differential pair", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(fixture) as SimpleRouteJson,
    { cacheProvider: null },
  )
  solver.solveUntilPhase("powerTraceExpansionSolver")
  solver.step()
  const powerInput = solver.powerTraceExpansionSolver!
    .inputSrj as Pipeline7PowerTraceExpansionInput
  const pairTrace = powerInput.fixedTraces[0]!
  const wire = pairTrace.route.find((point) => point.route_type === "wire")!
  wire.x += 1

  expect(() => solver.solve()).toThrow("was changed after initial routing")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
})
