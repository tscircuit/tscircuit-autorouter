import { expect, test } from "bun:test"
import input from "../../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { importReference } from "../../autorouter-bindings/integration/tsReference"

const { TinyHypergraphPortPointPathingSolver: Reference } = await importReference<{
  TinyHypergraphPortPointPathingSolver: typeof TinyHypergraphPortPointPathingSolver
}>("lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts")

test("tiny parent stats preserve delayed reads, assignments and retained snapshots", () => {
  type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  const actual = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
  const expected = new Reference(structuredClone(input) as Params)
  const normalize = (stats: Record<string, any>): unknown => {
    const output = structuredClone(stats)
    if (output.stageStats) {
      for (const stage of Object.values(output.stageStats) as Array<Record<string, unknown>>) delete stage.timeSpent
    }
    return output
  }
  expect(actual.stats).toEqual({})
  const held: Array<{ value: Record<string, any>; snapshot: unknown }> = []
  for (let step = 0; step < 500 && !expected.solved && !expected.failed; step++) {
    actual.step()
    expected.step()
    expect(actual.iterations).toBe(expected.iterations)
    expect(actual.solved).toBe(expected.solved)
    expect(actual.failed).toBe(expected.failed)
    if (step === 4) {
      const actualChild = (actual as any).tinyPipelineSolver.solveGraph
      const expectedChild = (expected as any).tinyPipelineSolver.solveGraph
      actualChild.stats.afterParentTick = "caller mutation"
      expectedChild.stats.afterParentTick = "caller mutation"
      expect(normalize(actual.stats)).toEqual(normalize(expected.stats))
      delete actualChild.stats.afterParentTick
      delete expectedChild.stats.afterParentTick
    }
    if (step % 3 === 0 || expected.solved || expected.failed) {
      expect(normalize(actual.stats)).toEqual(normalize(expected.stats))
      expect(actual.stats).toBe(actual.stats)
      held.push({ value: actual.stats, snapshot: structuredClone(actual.stats) })
    }
    if (step === 2) {
      const replacement = { manuallyAssigned: true }
      actual.stats = replacement
      expected.stats = { manuallyAssigned: true }
      expect(actual.stats).toBe(replacement)
    }
  }
  expect(actual.solved).toBe(true)
  for (const { value, snapshot } of held) expect(value).toEqual(snapshot)
  expect(actual.getOutput()).toEqual(expected.getOutput())
  expect(normalize(actual.stats)).toEqual(normalize(expected.stats))
})
