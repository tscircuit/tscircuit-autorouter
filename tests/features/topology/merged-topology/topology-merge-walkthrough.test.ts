import { expect, test } from "bun:test"
import {
  createSoicVerticalMergedTopologySrj,
  getMergedTopologyWalkthroughSvg,
} from "./fixtures"

test("merged topology walkthrough shows each merge stage", async (): Promise<void> => {
  await expect(
    getMergedTopologyWalkthroughSvg(createSoicVerticalMergedTopologySrj()),
  ).toMatchSvgSnapshot(import.meta.path)
})
