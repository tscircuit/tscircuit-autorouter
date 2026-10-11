import { expect, test } from "bun:test"
import { gunzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { HighDensityRepairSolver, type DatasetSample } from "high-density-repair02"
import { Pipeline9IndexedHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair02/Pipeline9IndexedHighDensityRepairSolver"

type Capture = { repairMargin: number; samples: DatasetSample[] }

test("indexed repair02 preserves all captured SRJ18 sample002 and006 routes, conflict stats and candidate budgets", (): void => {
  for (const sampleNumber of [2, 6]) {
    const input: Capture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
      `../fixtures/repair02-srj18/sample${String(sampleNumber).padStart(3, "0")}.json.gz`, import.meta.url,
    )))).toString())
    const totals = { initial: 0, final: 0, candidates: 0 }
    let giantFound = false
    for (const sample of input.samples) {
      const saved = structuredClone(sample)
      const params = { sample, margin: input.repairMargin, repairBoundaryDiagonals: false }
      const native = new HighDensityRepairSolver(params)
      const indexed = new Pipeline9IndexedHighDensityRepairSolver(params)
      native.solve()
      indexed.solve()
      expect(indexed.getSolverName()).toBe(native.getSolverName())
      expect(indexed.solved).toBe(native.solved)
      expect(indexed.failed).toBe(native.failed)
      expect(indexed.error).toBe(native.error)
      expect(indexed.iterations).toBe(native.iterations)
      expect(indexed.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      expect(indexed.stats).toEqual(native.stats)
      expect(indexed.getOutput()).toEqual(native.getOutput())
      expect(sample).toEqual(saved)
      totals.initial += Number(indexed.stats.nodeClearanceInitialConflictCount)
      totals.final += Number(indexed.stats.nodeClearanceFinalConflictCount)
      totals.candidates += Number(indexed.stats.nodeClearanceCandidateCount)
      if (sampleNumber === 2 && sample.nodeWithPortPoints?.capacityMeshNodeId === "cmn_3") {
        giantFound = true
        expect(indexed.stats.nodeClearanceInitialConflictCount).toBe(76)
        expect(indexed.stats.nodeClearanceFinalConflictCount).toBe(76)
        expect(indexed.stats.nodeClearanceCandidateCount).toBe(7296)
      }
    }
    expect(input.samples.length).toBe(sampleNumber === 2 ? 642 : 1537)
    expect(totals).toEqual(sampleNumber === 2
      ? { initial: 162, final: 113, candidates: 10054 }
      : { initial: 738, final: 555, candidates: 47665 })
    if (sampleNumber === 2) expect(giantFound).toBe(true)
  }
})
