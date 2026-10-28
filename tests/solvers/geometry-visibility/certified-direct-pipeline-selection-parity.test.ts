import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { CertifiedDirectAutoroutingPipelineSolver } from "lib/testing/CertifiedDirectAutoroutingPipelineSolver"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("explicit pipeline policies select the original solver before work and preserve its output and budgets", async () => {
  const blocked = getCertifiedDirectTestInput()
  blocked.obstacles = [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.6,
    layers: ["top"], connectedTo: [] }]
  const cases = [
    { input: getCertifiedDirectTestInput(), options: { cacheProvider: null, effort: 1, targetMinCapacity: 0.5 } },
    { input: blocked, options: { cacheProvider: null, effort: 1 } },
  ]
  for (const { input, options } of cases) {
    const original = JSON.stringify(input)
    const reference = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), options)
    const selected = new CertifiedDirectAutoroutingPipelineSolver(input, options)
    expect(selected.selectedStrategy).toBe("pipeline9")
    expect(selected.selection.eligible).toBe(false)
    expect(selected.getConstructorParams()[0]).toBe(input)
    expect(selected.getConstructorParams()[1]).toBe(options)
    expect(selected.pipeline9!.iterations).toBe(0)
    expect(selected.pipeline9!.MAX_ITERATIONS).toBe(reference.MAX_ITERATIONS)
    reference.solve()
    await selected.solveAsync()
    expect(reference.solved).toBe(true)
    expect(selected.solved).toBe(true)
    expect(selected.iterations).toBe(reference.iterations)
    expect(selected.MAX_ITERATIONS).toBe(reference.MAX_ITERATIONS)
    expect(selected.getOutputSimpleRouteJson()).toEqual(reference.getOutputSimpleRouteJson())
    expect(JSON.stringify(input)).toBe(original)
  }
})
