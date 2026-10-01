import { expect, test } from "bun:test"
import { runPipeline9RealBoardComparison } from "../fixtures/runPipeline9RealBoardComparison"
import "../fixtures/svg-matcher"

test("SRJ18 sample 1: real baseline and B copper snapshots retain failed/no-change evidence", async (): Promise<void> => {
  const result = await runPipeline9RealBoardComparison(
    1,
    ["baseline", "B"],
    import.meta.path,
  )
  await expect(result.svg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "before-after",
  })
  // Snapshot first, then enforce completion and the existing native DRC gate.
  // A failure remains visible in the committed expected board images.
  for (const run of result.runs) {
    expect(run.error).toBeNull()
    expect(run.solved).toBe(true)
    expect(run.failed).toBe(false)
    expect(run.nativeErrors).toEqual([])
  }
})
