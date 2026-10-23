import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/NegotiateTraceClearanceSolver"
import { ClearanceSearchTaskWorklist } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/ClearanceSearchTaskWorklist"
import { NegotiateTraceClearanceSolver as NativeNegotiation } from "@tscircuit/repair04"

test("default Pipeline9 stays clean and an unchanged real cropped repair task skips native search with identical effort coverage", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 4)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario), { effort: 1, cacheProvider: null },
  )
  let realInput: ConstructorParameters<typeof NegotiateTraceClearanceSolver>[0] | undefined
  while (!solver.solved && !solver.failed && !realInput) {
    solver.step()
    const child = solver.pipeline9JointDrcRepairSolver?.initialBoundedRegionalRepairSolver?.activeSubSolver
    if (child instanceof NegotiateTraceClearanceSolver) realInput = child.input
  }
  expect(realInput).toBeDefined()
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(evaluateRelaxedDrc({ inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }).errors).toEqual([])
  const stats = solver.pipeline9JointDrcRepairSolver!.searchTaskWorklist.getStats()
  expect(stats.searchTaskNativeInvocationCount).toBeGreaterThan(0)
  // Changed dependencies can legitimately make every default task dirty. The
  // board's actual skip count is evidence, rather than a forced positive label.
  expect(stats.searchTaskLookupCount).toBe(stats.searchTaskNativeInvocationCount + stats.searchTaskAvoidedInvocationCount)
  expect(solver.pipeline9JointDrcRepairSolver!.stats.searchTaskAvoidedInvocationCount)
    .toBe(stats.searchTaskAvoidedInvocationCount)
  expect(stats.searchTaskRetainedCount).toBeLessThanOrEqual(1024)
  expect(stats.searchTaskRetainedPoints).toBeLessThanOrEqual(100_000)
  expect(stats.searchTaskRetainedCharacters).toBeLessThanOrEqual(8_000_000)
  const worklist = new ClearanceSearchTaskWorklist()
  // One actual cropped task from this board, with its unchanged native node
  // allowance, is evaluated twice as a repeated regional pass.
  const input = { ...realInput!, maxPathSearchCalls: 1, searchTaskWorklist: worklist }
  const first = new NegotiateTraceClearanceSolver(input)
  const native = new NativeNegotiation(input)
  first.solve()
  native.solve()
  expect(first.getOutput()).toEqual(native.getOutput())
  const nativeInvocations = worklist.getStats().searchTaskNativeInvocationCount
  const repeated = new NegotiateTraceClearanceSolver(input)
  repeated.solve()
  expect(repeated.getOutput()).toEqual(native.getOutput())
  expect(repeated.stats.pathSearchNodes).toBe(native.stats.pathSearchNodes)
  expect(repeated.stats.pathSearchCalls).toBe(native.stats.pathSearchCalls)
  expect(worklist.getStats().searchTaskNativeInvocationCount).toBe(nativeInvocations)
  expect(worklist.getStats().searchTaskAvoidedInvocationCount).toBeGreaterThan(0)
})
