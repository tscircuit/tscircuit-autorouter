import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getCompletedDdrMeshSnapshotSvg } from "tests/fixtures/getCompletedDdrMeshSnapshotSvg"

test("shows the completed A64 topology and retained mesh working data", async (): Promise<void> => {
  const inputSrj: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../../fixtures/bug-reports/ddr-topology-validation/a64.input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    inputSrj,
    {
      effort: 1,
      cacheProvider: null,
    },
  )
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
  expect(merger.getOutput()).toHaveLength(98097)
  expect(
    createHash("sha256")
      .update(JSON.stringify(merger.getOutput()))
      .digest("hex"),
  ).toBe("87fba2d4517fb34b04ee878efdc6acf0556ebb7655f4ae27635cc5c75e2d6c70")
  const views = [
    { name: "top-layer", bounds: inputSrj.bounds },
    {
      name: "detail",
      bounds: { minX: -14, maxX: -12, minY: -16.5, maxY: -15 },
      outlineRegions: true,
    },
  ]
  for (const view of views) {
    await expect(
      getCompletedDdrMeshSnapshotSvg({
        solver: merger,
        boardName: "A64",
        view: view.bounds,
        outlineRegions: view.outlineRegions,
      }),
    ).toMatchSvgSnapshot(import.meta.path, {
      svgName: view.name,
      tolerance: 0,
    })
  }
})
