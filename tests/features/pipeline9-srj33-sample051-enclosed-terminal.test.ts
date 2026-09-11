import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 rejects the enclosed SRJ33 sample051 terminal before producing shorted copper", async (): Promise<void> => {
  const { scenario: srj, scenarioName } = await loadScenarioBySampleNumber(
    "srj33",
    32,
  )
  const original = structuredClone(srj)
  expect(scenarioName).toBe("sample051")
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
  expect(srj).toEqual(original)
})
