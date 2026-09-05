import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import {
  crossingTrace,
  snapshotInput,
} from "./fixtures/bug-report-snapshot-input"

test("bug report SVG counts and draws both existing and new copper", async () => {
  const input = {
    inputSrj: structuredClone(snapshotInput),
    srjWithPointPairs: structuredClone(snapshotInput),
    routedTraces: [structuredClone(crossingTrace)],
  }
  const original = structuredClone(input)
  const { errors } = evaluateRelaxedDrc(input)
  const svg = getBugReportSnapshotSvg(input)

  // One crossing plus four unterminated ends under benchmark defaults.
  expect(errors).toHaveLength(5)
  expect(svg).toContain(`Relaxed DRC errors: ${errors.length}</text>`)
  expect(svg).toContain('data-points="-1,0 1,0"')
  expect(svg).toContain('data-points="0,-1 0,1"')
  expect(input).toEqual(original)
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
