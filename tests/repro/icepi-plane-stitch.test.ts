import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteJson } from "lib/types"
import { getIcepiPlaneStitchSnapshotSvg } from "tests/fixtures/getIcepiPlaneStitchSnapshotSvg"

type StitchCapture = {
  params: ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0]
  srj: SimpleRouteJson
}

test("captures the full iCE/Pi plane phase before DRC repair", async (): Promise<void> => {
  // Native fragments from Blacksmith run 44051672939, with the full board's
  // pad geometry. This is stitching output, before downstream DRC repair.
  const captureBytes = new Uint8Array(
    readFileSync(
      new URL("./assets/icepi-plane-stitch.capture.json.gz", import.meta.url),
    ),
  )
  const capture = JSON.parse(
    gunzipSync(captureBytes).toString(),
  ) as StitchCapture
  const solver = new MultipleHighDensityRouteStitchSolver3(capture.params)
  solver.solve()
  expect(capture.params.connections).toHaveLength(559)
  expect(solver.mergedHdRoutes).toHaveLength(559)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  await expect(
    getIcepiPlaneStitchSnapshotSvg({
      srj: capture.srj,
      hdRoutes: solver.mergedHdRoutes,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
