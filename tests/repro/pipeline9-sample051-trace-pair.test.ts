import { expect, test } from "bun:test"
import { sample051 } from "@tscircuit/dataset-srj33-drc-failures"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 rejects the solar charger's trapped BGA terminal", (): void => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(sample051) as unknown as SimpleRouteJson,
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()

  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  expect(solver.error).toBe(
    'Unroutable under these constraints: connection "source_net_25" ' +
      'terminal "pcb_port_48" in BGA "pcb_component_12" on top ' +
      "has no trace escape (0.150 mm width, 0.100 mm pad clearance) " +
      "and no legal via placement (0.450 mm pad, 0.300 mm hole, " +
      "0.100 mm pad clearance).",
  )
  expect(solver.escapeViaLocationSolver).toBeUndefined()
  expect(solver.highDensityRouteSolver).toBeUndefined()
  // Repeated stepping must not turn a failed preflight into a solved board.
  solver.step()
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
})
