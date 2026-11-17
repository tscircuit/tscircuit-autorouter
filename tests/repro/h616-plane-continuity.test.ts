import { expect, test } from "bun:test"
import { getH616PlaneContinuityFixture } from "tests/fixtures/getH616PlaneContinuityFixture"
import { getH616PlaneContinuitySnapshotSvg } from "tests/fixtures/getH616PlaneContinuitySnapshotSvg"

test("H616 plane escapes retain the declared external connection during DRC", async (): Promise<void> => {
  const input = getH616PlaneContinuityFixture()
  await expect(getH616PlaneContinuitySnapshotSvg(input)).toMatchSvgSnapshot(import.meta.path)
})
