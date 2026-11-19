import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("preloaded A64 DQ traces retain ownership of their pads", async (): Promise<void> => {
  const fixture = readFileSync(
    new URL("../fixtures/a64-fixed-trace-handoff.srj.json.gz", import.meta.url),
  )
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(new Uint8Array(fixture)).toString(),
  )
  // This handoff contains completed DQ copper; other signals are unfinished.
  const svg = getBugReportSnapshotSvg({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: [],
    drcOptions: { includeTraceContinuity: false },
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
