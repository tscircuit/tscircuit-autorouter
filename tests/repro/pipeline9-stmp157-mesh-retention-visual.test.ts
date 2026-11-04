import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getStmp157MeshSnapshotSvg } from "tests/fixtures/getStmp157MeshSnapshotSvg"

test("STMP157 keeps the same intermediate mesh without redundant vertical splits", async (): Promise<void> => {
  const inputSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-remaining-mesh/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    effort: 1,
    cacheProvider: null,
  })
  // Compare the same real input at identical progress on both branches.
  while (!solver.solved && !solver.failed) {
    const merger = solver.topologyMergingSolver
    if (merger && merger.stats.processedXSlabCount >= 1000) break
    solver.step()
  }
  expect(solver.failed, solver.error ?? "").toBe(false)
  const merger = solver.topologyMergingSolver!
  expect(merger).toBeDefined()
  expect(merger.stats.processedXSlabCount).toBe(1000)
  await expect(getStmp157MeshSnapshotSvg(merger)).toMatchSvgSnapshot(
    import.meta.path,
    { tolerance: 0 },
  )
  expect(merger.stats.atomicRegionCount).toBeLessThan(100_000)
})
