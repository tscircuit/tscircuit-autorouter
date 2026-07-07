import { expect, test } from "bun:test"
import {
  createQfpThermalPadMergedTopologySrj,
  getMergedTopologySvg,
} from "./fixtures"

test("merged topology preserves inner targets around QFP thermal pad", async (): Promise<void> => {
  await expect(
    getMergedTopologySvg(createQfpThermalPadMergedTopologySrj()),
  ).toMatchSvgSnapshot(import.meta.path)
})
