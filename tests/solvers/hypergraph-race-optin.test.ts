import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("legacy callers retain native routing while the new implementation runs four candidates", (): void => {
  type Params = ConstructorParameters<
    typeof TinyHypergraphPortPointPathingSolver
  >[0]
  const legacy = new TinyHypergraphPortPointPathingSolver(
    structuredClone(input) as Params,
  )
  legacy.solve()
  expect(legacy.solved).toBe(true)
  expect(
    legacy.getSolveGraphBenchmarkMetrics()?.raceCandidateCount,
  ).toBeUndefined()
  const racing = new TinyHypergraphPortPointPathingSolver({
    ...structuredClone(input),
    useDeterministicRace: true,
  } as Params)
  racing.solve()
  expect(racing.solved).toBe(true)
  expect(racing.getSolveGraphBenchmarkMetrics()?.raceCandidateCount).toBe(4)
})
