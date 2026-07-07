import { expect, test } from "bun:test"
import {
  createSoicVerticalMergedTopologySrj,
  getMergedTopologySvg,
} from "./fixtures"

test("merged topology preserves inner targets in vertical SOIC center", async (): Promise<void> => {
  await expect(
    getMergedTopologySvg(createSoicVerticalMergedTopologySrj()),
  ).toMatchSvgSnapshot(import.meta.path)
})
