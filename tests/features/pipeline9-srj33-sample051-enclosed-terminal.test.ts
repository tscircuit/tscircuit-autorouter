import { expect, test } from "bun:test"
import { sample051 } from "@tscircuit/dataset-srj33-drc-failures"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 rejects the enclosed SRJ33 sample051 terminal before producing shorted copper", (): void => {
  const srj = structuredClone(sample051) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 1,
  })

  solver.solve()

  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  expect(solver.error).toContain("Unroutable terminal pcb_port_48")
  expect(solver.error).toContain('connection "source_net_25"')
  expect(solver.error).toContain("trace width 0.15 mm and clearance 0.1 mm")
  expect(solver.error).toContain("allowViaInPad is false")
  expect(solver.iterations).toBe(1)
  expect(solver.highDensityRouteSolver).toBeUndefined()
  expect(srj).toEqual(sample051)
})
