import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors, type GetDrcErrorsOptions, type GetDrcErrorsResult } from "../../lib/testing/getDrcErrors"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { checkViaTraceClearanceWithLazyCenters, type LazyViaTraceCenterDiagnostics } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { getViaTraceAxisBounds, getViaTraceAxisQuery, isViaTraceAxisSeparated } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/getViaTraceAxisBounds"
import { getTraceObstacleClearance, getTraceSegments } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-pad-clearance/common"
import { EPSILON } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/drc-defaults"
import type { PcbTraceSegment } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-each-pcb-trace-non-overlapping/getCollidableBounds"

type ReferenceCapture = { circuitJson: AnyCircuitElement[]; options: GetDrcErrorsOptions; expected: GetDrcErrorsResult }

function compareChecker(circuit: AnyCircuitElement[], minClearance = 0.2): ReturnType<typeof checkViaTraceClearance> {
  const connMap = new ConnectivityMap({ viaNet: ["v"], traceNet: ["t"], otherNet: ["other"] })
  const options = { connMap, minClearance }
  const native = checkViaTraceClearance(circuit, options)
  const actual = checkViaTraceClearanceWithLazyCenters(circuit, { ...options, enableAxisRejection: true })
  deepStrictEqual(actual, native)
  return actual
}

function makeCircuit(x1: number, y1: number, x2: number, y2: number, viaX: number, viaY: number, thickness = 0.1, diameter = 0.2): AnyCircuitElement[] {
  return [
    { type: "pcb_via", pcb_via_id: "v", x: viaX, y: viaY, outer_diameter: diameter, hole_diameter: 0.1, layers: ["top"] },
    { type: "pcb_trace", pcb_trace_id: "t", route: [
      { route_type: "wire", x: x1, y: y1, width: thickness, layer: "top" },
      { route_type: "wire", x: x2, y: y2, width: 9, layer: "top" },
    ] },
  ] as AnyCircuitElement[]
}

test("conservative via-trace axes retain full sample015 reference checks and adversarial native numerical behavior", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: ReferenceCapture[] }
  const count: LazyViaTraceCenterDiagnostics = { eligibleChecks: 0, nativeChecks: 0, gapCalls: 0, centerCalls: 0, axisRejected: 0 }
  for (const capture of fixture.records) {
    const native = getDrcErrors(capture.circuitJson, capture.options)
    const actual = getDrcErrors(capture.circuitJson, {
      ...capture.options,
      viaTraceChecker: (circuit, options): ReturnType<typeof checkViaTraceClearance> =>
        checkViaTraceClearanceWithLazyCenters(circuit, { ...options, diagnostics: count, enableAxisRejection: true }),
    })
    deepStrictEqual(actual, native)
    deepStrictEqual(JSON.parse(JSON.stringify(actual)), capture.expected)
  }
  expect(count.eligibleChecks).toBe(17)
  expect(count.nativeChecks).toBe(0)
  expect(count.axisRejected).toBe(16_594_411)
  expect(count.gapCalls).toBe(11_640)
  expect(count.centerCalls).toBe(466)

  // Native nonzero tiny segments can divide 0/0 despite a distant via. Their
  // resulting NaN gap is an error, rather than a distant pair to discard.
  const underflow = makeCircuit(0, 0, Number.MIN_VALUE, 0, 0, 100)
  expect(getViaTraceAxisBounds(getTraceSegments(underflow)[0]!)).toBeUndefined()
  const underflowResult = compareChecker(underflow)
  expect(underflowResult).toHaveLength(1)
  expect(Number.isNaN(underflowResult[0]!.actual_clearance)).toBe(true)
  compareChecker(makeCircuit(-0, 0, 0, -0, 100, 100, 0, 0), 0)
  compareChecker(makeCircuit(0, 0, 2 ** -511, 0, 100, 100))
  const overflow = makeCircuit(-1e200, 0, 1e200, 0, 100, 100)
  expect(getViaTraceAxisBounds(getTraceSegments(overflow)[0]!)).toBeUndefined()
  compareChecker(overflow)

  // An overlap on a later duplicate trace deletes its earlier error and keeps
  // suppressing that ordered via/trace pair. Far-axis omissions cannot alter it.
  const duplicates = makeCircuit(-1, 0.25, 1, 0.25, 0, 0)
  for (const y of [100, 0.01, 100, 0.25]) {
    duplicates.push((makeCircuit(-1, y, 1, y, 0, 0)[1])!)
  }
  duplicates.push(makeCircuit(-1, 0.24, 1, 0.24, 0, 0)[1]!)
  ;(duplicates[duplicates.length - 1] as Extract<AnyCircuitElement, { type: "pcb_trace" }>).pcb_trace_id = "other"
  expect(compareChecker(duplicates).map((error) => error.pcb_trace_id)).toEqual(["other"])
  for (const minClearance of [-1, 0, 0.005, 0.2, 10000, 10001, Number.POSITIVE_INFINITY]) compareChecker(makeCircuit(0, 0, 1, 1, 100, 100), minClearance)
  for (const value of [-10000, -9999.999999999998, -0, 0, 9999.999999999998, 10000, 10001]) {
    for (const offset of [-1e-8, -Number.EPSILON, -0, 0, Number.EPSILON, 1e-8]) {
      compareChecker(makeCircuit(value, value, value, value, value + 0.35 + offset, value, 0.1, 0.2))
    }
  }

  let state = 0x38cf1027
  const random = (): number => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5
    return (state >>> 0) / 2 ** 32
  }
  const exponents = [-1074, -1022, -600, -550, -512, -511, -500, -100, -20, -1, 0, 2, 10, 13]
  const coordinate = (): number => (random() < 0.5 ? -1 : 1) * (0.5 + random() / 2) * 2 ** exponents[Math.floor(random() * exponents.length)]!
  let separated = 0
  let near = 0
  for (let iteration = 0; iteration < 30_000; iteration++) {
    const x1 = coordinate(), y1 = coordinate(), x2 = coordinate(), y2 = coordinate()
    const thickness = random() < 0.1 ? 0 : random() * 10
    const diameter = random() < 0.1 ? 0 : random() * 10
    const minClearance = random() < 0.1 ? 0 : random() * 10
    const viaX = iteration % 4 === 0 ? Math.max(x1, x2) + thickness / 2 + diameter / 2 + minClearance + (random() - 0.5) * 4e-8 : coordinate()
    const viaY = coordinate()
    const segment = { x1, y1, x2, y2, thickness } as PcbTraceSegment
    const via = { type: "pcb_via", x: viaX, y: viaY, outer_diameter: diameter } as PcbVia
    const bounds = getViaTraceAxisBounds(segment)
    const query = getViaTraceAxisQuery(via, minClearance)
    const gap = getTraceObstacleClearance(segment, via).gap
    if (bounds && query && isViaTraceAxisSeparated(bounds, query)) {
      separated++
      expect(gap).toBeGreaterThan(0)
      expect(gap + EPSILON).toBeGreaterThanOrEqual(minClearance)
    } else near++
    if (iteration < 100) compareChecker(makeCircuit(x1, y1, x2, y2, viaX, viaY, thickness, diameter), minClearance)
  }
  expect(separated).toBeGreaterThan(5_000)
  expect(near).toBeGreaterThan(100)
})
