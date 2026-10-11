import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
import { HighDensityRepairSolver, type DatasetSample } from "high-density-repair02"

type OriginalResult = {
  sourceNode: number
  sample: DatasetSample
  hash: string
  candidateCount: number
  initialConflictCount: number
  finalConflictCount: number
}

test("cached copper scenes preserve original dataset18 repairs and candidate sweeps", async () => {
  const bytes = await Bun.file(new URL("../fixtures/repair02-copper-scene-original-results.json.gz", import.meta.url)).arrayBuffer()
  const originalResults: OriginalResult[] = JSON.parse(gunzipSync(bytes).toString())
  for (const original of originalResults) {
    const solver = new HighDensityRepairSolver({
      repairBoundaryDiagonals: false,
      sample: original.sample,
      margin: 0.2,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const hash = createHash("sha256").update(JSON.stringify(solver.getOutput())).digest("hex")
    expect(hash).toBe(original.hash)
    expect(solver.stats.nodeClearanceCandidateCount).toBe(original.candidateCount)
    expect(solver.stats.nodeClearanceInitialConflictCount).toBe(original.initialConflictCount)
    expect(solver.stats.nodeClearanceFinalConflictCount).toBe(original.finalConflictCount)
  }
})
