import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { getOrangeCrabClearanceStageGraphics } from "tests/fixtures/getOrangeCrabClearanceStageGraphics"

test("OrangeCrab native DDR clearance at B01 completion", async (): Promise<void> => {
  const svg: string = getSvgFromGraphicsObject(
    getOrangeCrabClearanceStageGraphics(),
    { backgroundColor: "white", includeTextLabels: false },
  ).replace(/[ \t]+$/gm, "")
  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
})
