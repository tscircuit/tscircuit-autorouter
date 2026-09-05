import { expect, test } from "bun:test"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import {
  crossingTrace,
  snapshotInput,
} from "./fixtures/bug-report-snapshot-input"

test("bug report SVG removes replaced copper from its count and drawing", () => {
  const svg = getBugReportSnapshotSvg({
    inputSrj: structuredClone(snapshotInput),
    srjWithPointPairs: structuredClone(snapshotInput),
    drcOptions: { includeTraceContinuity: false },
    routedTraces: [
      { ...structuredClone(crossingTrace), __replaces_pcb_trace_id: "existing" },
    ],
  })

  expect(svg).toContain("Relaxed DRC errors: 0</text>")
  expect(svg).not.toContain('data-points="-1,0 1,0"')
  expect(svg).toContain('data-points="0,-1 0,1"')
})
