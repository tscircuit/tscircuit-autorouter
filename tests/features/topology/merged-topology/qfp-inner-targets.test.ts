import { expect, test } from "bun:test"
import { createQfpMergedTopologySrj, getMergedTopologySvg } from "./fixtures"

test("merged topology preserves inner targets in QFP center", async (): Promise<void> => {
  await expect(
    getMergedTopologySvg(createQfpMergedTopologySrj()),
  ).toMatchSvgSnapshot(import.meta.path)
})
