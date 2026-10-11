import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import {
  getDrcErrors,
  type GetDrcErrorsOptions,
  type GetDrcErrorsResult,
} from "../../lib/testing/getDrcErrors"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { checkTracesAreContiguous } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"

type ReferenceCapture = {
  number: number
  circuitJson: AnyCircuitElement[]
  options: GetDrcErrorsOptions
  expected: GetDrcErrorsResult
}
type CapturedFixture = {
  sample: number
  jointGeometryHash: string
  records: ReferenceCapture[]
}

function compareNativeReference(
  capture: ReferenceCapture,
  memo: ReferenceDrcPrimitiveMemo,
): GetDrcErrorsResult {
  const native = getDrcErrors(capture.circuitJson, capture.options)
  const actual = getDrcErrors(capture.circuitJson, {
    ...capture.options,
    traceContinuityChecker: (circuitJson): ReturnType<typeof checkTracesAreContiguous> =>
      checkTracesAreContiguous(circuitJson, { primitiveMemo: memo }),
  })
  deepStrictEqual(actual, native)
  return native
}

test("memoized reference DRC preserves all captured sample015 graphs, full ordered results and in-place mutations", (): void => {
  // Complete inputs from the native Joint reference hook, including constructor
  // baseline/current checks and the consumed regional-repair candidates.
  const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
    "../fixtures/reference-drc-srj18/sample015-native-reference.json.gz",
    import.meta.url,
  )))).toString()) as CapturedFixture
  expect(fixture.sample).toBe(15)
  expect(fixture.jointGeometryHash).toBe("395a95ac6f4e25a6b2744e5c0c1e3385436803ebb81589b727a0e88cb832a7c4")
  expect(fixture.records).toHaveLength(17)
  const memo = new ReferenceDrcPrimitiveMemo()
  for (const capture of fixture.records) {
    const native = compareNativeReference(capture, memo)
    // JSON is the portable representation of captured native optional fields;
    // the live native/memo comparison above also checks their exact own shape.
    deepStrictEqual(JSON.parse(JSON.stringify(native)), capture.expected)
  }
  expect(fixture.records.map((capture) => capture.expected.errors.length)).toEqual([
    0, 346, 251, 158, 130, 116, 105, 101, 100, 101, 100, 1, 6, 1, 2, 1, 0,
  ])
  const current = fixture.records[1]!
  expect(current.circuitJson.filter((element) => element.type === "pcb_trace")).toHaveLength(461)
  expect(current.circuitJson.filter((element) => element.type === "pcb_plated_hole")).toHaveLength(40)
  const hitsBeforeRepeat = memo.diagnostics.hits
  compareNativeReference(current, memo)
  expect(memo.diagnostics.hits).toBeGreaterThan(hitsBeforeRepeat)

  const trace = current.circuitJson.find((element) => element.type === "pcb_trace")!
  if (trace.type !== "pcb_trace") throw new Error("Captured sample015 has no routed trace")
  const point = trace.route.find((routePoint) => routePoint.route_type === "wire")!
  if (point.route_type !== "wire") throw new Error("Captured sample015 has no wire endpoint")
  const pad = current.circuitJson.find((element) => element.type === "pcb_smtpad" && element.shape === "rect")!
  if (pad.type !== "pcb_smtpad" || pad.shape !== "rect") throw new Error("Captured sample015 has no rectangular pad")
  const via = current.circuitJson.find((element) => element.type === "pcb_via")!
  if (via.type !== "pcb_via") throw new Error("Captured sample015 has no emitted via")
  const originalPoint = { x: point.x, width: point.width, layer: point.layer }
  const originalPadWidth = pad.width
  const originalViaLayers = via.layers
  const mutations: Array<{ apply: () => void; restore: () => void }> = [
    { apply: (): void => { point.x += 0.123 }, restore: (): void => { point.x = originalPoint.x } },
    { apply: (): void => { point.width *= 3 }, restore: (): void => { point.width = originalPoint.width } },
    { apply: (): void => { point.layer = "top" }, restore: (): void => { point.layer = originalPoint.layer } },
    { apply: (): void => { pad.width *= 4 }, restore: (): void => { pad.width = originalPadWidth } },
    { apply: (): void => { via.layers = ["top", "inner1"] }, restore: (): void => { via.layers = originalViaLayers } },
  ]
  for (const mutation of mutations) {
    mutation.apply()
    compareNativeReference(current, memo)
    mutation.restore()
    deepStrictEqual(JSON.parse(JSON.stringify(compareNativeReference(current, memo))), current.expected)
  }
  expect(memo.diagnostics.hits).toBeGreaterThan(0)
  expect(memo.diagnostics.misses).toBeGreaterThan(0)
})
