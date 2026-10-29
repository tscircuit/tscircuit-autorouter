import { expect, test } from "bun:test"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimplifiedPcbTrace } from "lib/types"
import { snapshotInput } from "./fixtures/bug-report-snapshot-input"

test("bug report SVG forwards explicit DRC rule overrides", () => {
  const nearbyTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "nearby",
    connection_name: "nearby",
    route: [
      { route_type: "wire", x: -1, y: 0.15, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0.15, width: 0.1, layer: "top" },
    ],
  }
  const input = {
    inputSrj: structuredClone(snapshotInput),
    srjWithPointPairs: structuredClone(snapshotInput),
    routedTraces: [nearbyTrace],
    drcOptions: { includeTraceContinuity: false },
  }

  expect(getBugReportSnapshotSvg(input)).toContain(
    "Relaxed DRC errors: 1</text>",
  )
  expect(
    getBugReportSnapshotSvg({
      ...input,
      drcOptions: { ...input.drcOptions, traceClearance: 0.01 },
    }),
  ).toContain("Relaxed DRC errors: 0</text>")
})
