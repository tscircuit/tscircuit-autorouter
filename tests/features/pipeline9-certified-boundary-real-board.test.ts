import { expect, test } from "bun:test"
import { dataset } from "dataset-srj18"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"

test("physical boundary certificates retain real moved interfaces, skip detailed searches and finish a clean board", (): void => {
  const input = structuredClone(dataset.sample003)
  const solver = new Pipeline(input, { effort: 1, cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const boundary = solver.boundaryContractSolver!
  expect(boundary.stats.boundaryProofAttempts).toBeGreaterThan(0)
  expect(boundary.stats.boundaryProofRetainedMovedPorts).toBeGreaterThan(0)
  expect(boundary.stats.boundaryProofCellCount).toBeGreaterThan(0)
  expect(solver.highDensityRouteSolver!.stats.boundaryCertificateSkippedSearches).toBeGreaterThan(0)
  expect(solver.highDensityRouteSolver!.stats.boundaryCertificateConsumed).toBe(boundary.stats.boundaryProofCellCount)
  expect(evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces(), includeBoardClearance: true }).errors).toEqual([])
})
