import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getCompletedDdrMeshSnapshotSvg } from "tests/fixtures/getCompletedDdrMeshSnapshotSvg"

test("shows the completed STM32MP157 topology and retained mesh working data", async (): Promise<void> => {
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
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    effort: 1,
    cacheProvider: null,
  })
  while (
    !pipeline.solved &&
    !pipeline.failed &&
    !pipeline.topologyMergingSolver?.solved
  ) {
    pipeline.step()
  }
  expect(pipeline.failed, pipeline.error ?? "").toBe(false)
  const merger = pipeline.topologyMergingSolver!
  expect(merger.solved).toBe(true)
  expect(merger.getOutput()).toHaveLength(115881)
  expect(
    createHash("sha256")
      .update(JSON.stringify(merger.getOutput()))
      .digest("hex"),
  ).toBe("47d8fdefcebe030fe5155b4c2170bbdd23e7d154208f339d4b940b18285867fe")
  const views = [
    { name: "top-layer", bounds: inputSrj.bounds, outlineRegions: false },
    {
      name: "detail",
      bounds: { minX: -18, maxX: -16, minY: -9, maxY: -7.5 },
      outlineRegions: true,
    },
  ]
  for (const view of views) {
    await expect(
      getCompletedDdrMeshSnapshotSvg({
        solver: merger,
        boardName: "STM32MP157",
        view: view.bounds,
        outlineRegions: view.outlineRegions,
      }),
    ).toMatchSvgSnapshot(import.meta.path, {
      svgName: view.name,
      tolerance: 0,
    })
  }
})
