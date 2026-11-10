import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("detects packages on the real A64 DDR board after data-byte routing", async (): Promise<void> => {
  const fixture = new URL(
    "../fixtures/assets/a64-cpu-bga-detection/input.srj.json.gz",
    import.meta.url,
  )
  const inputSrj = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixture))).toString("utf8"),
  ) as SimpleRouteJson
  const before = structuredClone(inputSrj)
  const solver = new ComponentDetectionSolver({ inputSrj })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(inputSrj).toEqual(before)

  const graphics = convertSrjToGraphicsObject(inputSrj)
  const detectedPackages = solver
    .rectBoundsComponentDetection!.visualize()
    .rects!.filter((rect) => rect.step === 2)
  graphics.rects.push(...detectedPackages.map(({ step, ...rect }) => rect))
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
