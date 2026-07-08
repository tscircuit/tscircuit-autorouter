import { expect, test } from "bun:test"
import { createBgaMergedTopologySrj, getMergedTopologySvg } from "./fixtures"

test("merged topology preserves inner targets in BGA grid", async (): Promise<void> => {
  await expect(
    getMergedTopologySvg(createBgaMergedTopologySrj()),
  ).toMatchSvgSnapshot(import.meta.path)
})
