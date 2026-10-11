import { expect, test } from "bun:test"
import { Box, Point, Polygon, Utils, type Arc, type Segment } from "@flatten-js/core"
import { checkTracesAreContiguous as nativeContinuityChecker } from "@tscircuit/checks"
import { circlePolygon, getPourPolygon, getTraceSegmentPolygon } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement, PcbCopperPour, PcbVia } from "circuit-json"
import { deepStrictEqual, strictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getDrcErrors, type GetDrcErrorsOptions, type GetDrcErrorsResult } from "../../lib/testing/getDrcErrors"
import { canUseExpectedPortsMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/canUseExpectedPortsMemo"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { ScaledConductorPolygonMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ScaledConductorPolygonMemo"
import { createPrivatelyMemoizedTraceContinuityChecker } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"
import { getViaAndPourConnections } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/util/get-via-and-pour-connections"
import { createCopperPolygonContactTester } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/copper-pour-connectivity/create-copper-polygon-contact-tester"

type Capture = { circuitJson: AnyCircuitElement[]; options: GetDrcErrorsOptions; expected: GetDrcErrorsResult }
type Element = Record<string, any>

function geometrySnapshot(polygon: Polygon): unknown {
  return structuredClone({
    box: polygon.box,
    faces: [...polygon.faces].map((face) => face.shapes.map((shape: Arc | Segment) => shape.toJSON())),
    edges: [...polygon.edges].map((edge) => edge.shape.toJSON()),
  })
}

function makeCircuit(): AnyCircuitElement[] {
  const wire = (x: number, y: number, layer = "top"): Element => ({ route_type: "wire", x, y, width: 0.1, layer })
  return [
    { type: "pcb_board", pcb_board_id: "board", center: { x: 0, y: 0 }, width: 10, height: 10, num_layers: 4, thickness: 1.6 },
    { type: "pcb_via", pcb_via_id: "v", pcb_trace_id: "t", x: 0, y: 0, outer_diameter: 0.3, hole_diameter: 0.1, layers: ["top", "inner1"] },
    { type: "pcb_trace", pcb_trace_id: "t", route: [wire(-1, 0), wire(1, 0)] },
    { type: "pcb_trace", pcb_trace_id: "other", route: [wire(0, -1), wire(0, 1)] },
    { type: "pcb_trace", pcb_trace_id: "route-via", route: [wire(1, 0), { route_type: "via", x: 1, y: 0, from_layer: "top", to_layer: "bottom", outer_diameter: 0.3 }, wire(1, 0, "bottom"), wire(2, 0, "bottom")] },
    { type: "pcb_copper_pour", pcb_copper_pour_id: "pour", layer: "top", shape: "rect", center: { x: 0, y: 0 }, width: 0.5, height: 0.5, rotation: 23 },
  ] as AnyCircuitElement[]
}

test("private scaled native conductor polygons retain complete reference order, geometry, mutations, bounded storage and observer errors", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const captures = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: Capture[] }
  const nativeMemo = new ReferenceDrcPrimitiveMemo()
  const actualMemo = new ReferenceDrcPrimitiveMemo()
  const polygons = new ScaledConductorPolygonMemo()
  const checker = createPrivatelyMemoizedTraceContinuityChecker()
  for (const capture of captures.records) {
    expect(canUseExpectedPortsMemo(capture.circuitJson)).toBe(true)
    const original = structuredClone(capture.circuitJson)
    deepStrictEqual(getViaAndPourConnections(capture.circuitJson, actualMemo, polygons), getViaAndPourConnections(capture.circuitJson, nativeMemo))
    deepStrictEqual(capture.circuitJson, original)
    const native = getDrcErrors(capture.circuitJson, capture.options)
    const actual = getDrcErrors(capture.circuitJson, { ...capture.options, traceContinuityChecker: checker })
    deepStrictEqual(actual, native)
    deepStrictEqual(JSON.parse(JSON.stringify(actual)), capture.expected)
  }
  expect(polygons.diagnostics.hits).toBe(52_515)
  expect(polygons.diagnostics.creations).toBe(15_191)
  expect(polygons.diagnostics.entries).toBe(15_191)
  expect(polygons.diagnostics.edges).toBe(53_096)
  expect(polygons.diagnostics.evictions).toBe(0)

  const ownInput = makeCircuit()
  const compare = (): string[][] => {
    const before = structuredClone(ownInput)
    const expected = getViaAndPourConnections(ownInput, nativeMemo)
    const actual = getViaAndPourConnections(ownInput, actualMemo, polygons)
    deepStrictEqual(actual, expected)
    deepStrictEqual(ownInput, before)
    return actual
  }
  const first = compare()
  const repeated = compare()
  expect(repeated).not.toBe(first)
  expect(repeated[0]).not.toBe(first[0])
  first[0]![0] = "never-published-polygon-alias"
  deepStrictEqual(compare(), repeated)
  const via = ownInput[1] as PcbVia
  const trace = ownInput[2] as Extract<AnyCircuitElement, { type: "pcb_trace" }>
  const start = trace.route[0] as Extract<typeof trace.route[number], { route_type: "wire" }>
  const pour = ownInput[5] as PcbCopperPour
  const originalVia = { x: via.x, diameter: via.outer_diameter, layers: via.layers }
  const originalWire = { x: start.x, width: start.width, layer: start.layer }
  const mutations: Array<{ apply: () => void; restore: () => void }> = [
    { apply: (): void => { via.x += 0.6 }, restore: (): void => { via.x = originalVia.x } },
    { apply: (): void => { via.outer_diameter *= 4 }, restore: (): void => { via.outer_diameter = originalVia.diameter } },
    { apply: (): void => { via.layers = ["bottom"] }, restore: (): void => { via.layers = originalVia.layers } },
    { apply: (): void => { start.x += 0.2 }, restore: (): void => { start.x = originalWire.x } },
    { apply: (): void => { start.width *= 7 }, restore: (): void => { start.width = originalWire.width } },
    { apply: (): void => { start.layer = "bottom" }, restore: (): void => { start.layer = originalWire.layer } },
  ]
  for (const mutation of mutations) { mutation.apply(); compare(); mutation.restore(); compare() }
  Reflect.set(pour, "rotation", 67); compare(); Reflect.set(pour, "rotation", 23); compare()
  const ring = (xmin: number, ymin: number, xmax: number, ymax: number): Element => ({ vertices: [{ x: xmin, y: ymin }, { x: xmax, y: ymin }, { x: xmax, y: ymax }, { x: xmin, y: ymax }] })
  Reflect.set(pour, "shape", "brep")
  Reflect.set(pour, "brep_shape", { outer_ring: ring(-0.5, -0.5, 0.5, 0.5), inner_rings: [ring(-0.1, -0.1, 0.1, 0.1)] })
  compare()
  ;(pour as unknown as Element).brep_shape.inner_rings[0].vertices[0].x = -0.3
  compare()
  ;(pour as unknown as Element).brep_shape.inner_rings = []
  compare()

  const guardedGraph = (circuit: AnyCircuitElement[], memo: ReferenceDrcPrimitiveMemo, storage: ScaledConductorPolygonMemo): string[][] =>
    getViaAndPourConnections(circuit, memo, canUseExpectedPortsMemo(circuit) ? storage : undefined)
  const scaleDescriptor = Object.getOwnPropertyDescriptor(Polygon.prototype, "scale")!
  const nativeScale = scaleDescriptor.value as (this: Polygon, sx: number, sy: number) => Polygon
  const events: unknown[] = []
  Object.defineProperty(Polygon.prototype, "scale", { ...scaleDescriptor, value: function(this: Polygon, sx: number, sy: number): Polygon {
    events.push(geometrySnapshot(this))
    return nativeScale.call(this, sx, sy)
  } })
  try {
    expect(canUseExpectedPortsMemo(ownInput)).toBe(false)
    const expected = getViaAndPourConnections(ownInput, nativeMemo)
    const nativeEvents = events.slice()
    events.length = 0
    deepStrictEqual(guardedGraph(ownInput, actualMemo, polygons), expected)
    deepStrictEqual(events, nativeEvents)
  } finally { Object.defineProperty(Polygon.prototype, "scale", scaleDescriptor) }

  const failure = new RangeError("original native scale error")
  Object.defineProperty(Polygon.prototype, "scale", { ...scaleDescriptor, value: (): never => { throw failure } })
  try {
    let actualError: unknown
    try { checker(makeCircuit()) } catch (error) { actualError = error }
    strictEqual(actualError, failure)
  } finally { Object.defineProperty(Polygon.prototype, "scale", scaleDescriptor) }
  const memoMethod = Object.getOwnPropertyDescriptor(ScaledConductorPolygonMemo.prototype, "getOrCreate")!
  Object.defineProperty(ScaledConductorPolygonMemo.prototype, "getOrCreate", { configurable: true, get: (): never => { throw new Error("must not read changed memo hook") } })
  try { expect(canUseExpectedPortsMemo(ownInput)).toBe(false) }
  finally { Object.defineProperty(ScaledConductorPolygonMemo.prototype, "getOrCreate", memoMethod) }

  // Flatten's tolerance setter changes private numeric state without changing
  // any method descriptor. Both retained polygons and predicate answers must
  // be bypassed at that native setting, including original constructor errors.
  const toleranceCircuit = [
    { type: "pcb_via", pcb_via_id: "v", x: 0, y: 0, outer_diameter: 0.2, hole_diameter: 0.1, layers: ["top"] },
    { type: "pcb_trace", pcb_trace_id: "t", route: [
      { route_type: "wire", x: 0.01, y: 0, width: 0.0001, layer: "top" },
      { route_type: "wire", x: 0.0101, y: 0, width: 0.0001, layer: "top" },
    ] },
  ] as AnyCircuitElement[]
  const toleranceChecker = createPrivatelyMemoizedTraceContinuityChecker()
  const originalTolerance = Utils.getTolerance()
  const toleranceBefore = structuredClone(toleranceCircuit)
  const toleranceResult = nativeContinuityChecker(toleranceCircuit)
  deepStrictEqual(toleranceChecker(toleranceCircuit), toleranceResult)
  deepStrictEqual(getViaAndPourConnections(toleranceCircuit), [["v", "t"]])
  try {
    Utils.setTolerance(10)
    expect(canUseExpectedPortsMemo(toleranceCircuit)).toBe(false)
    let nativeError: unknown
    let actualError: unknown
    try { nativeContinuityChecker(toleranceCircuit) } catch (error) { nativeError = error }
    try { toleranceChecker(toleranceCircuit) } catch (error) { actualError = error }
    expect(nativeError).toBeInstanceOf(ReferenceError)
    expect((nativeError as Error).message).toBe("Illegal Parameters")
    expect(actualError).toBeInstanceOf(ReferenceError)
    expect((actualError as Error).message).toBe((nativeError as Error).message)
  } finally { Utils.setTolerance(originalTolerance) }
  expect(canUseExpectedPortsMemo(toleranceCircuit)).toBe(true)
  deepStrictEqual(toleranceChecker(toleranceCircuit), toleranceResult)
  deepStrictEqual(toleranceCircuit, toleranceBefore)

  const containsDescriptor = Object.getOwnPropertyDescriptor(Polygon.prototype, "contains")!
  Object.defineProperty(Polygon.prototype, "contains", { ...containsDescriptor, value: (): never => { throw failure } })
  try {
    let nativeError: unknown
    let actualError: unknown
    try { nativeContinuityChecker(toleranceCircuit) } catch (error) { nativeError = error }
    try { toleranceChecker(toleranceCircuit) } catch (error) { actualError = error }
    strictEqual(nativeError, failure)
    strictEqual(actualError, failure)
  } finally { Object.defineProperty(Polygon.prototype, "contains", containsDescriptor) }

  let containsGetterReads = 0
  Object.defineProperty(Polygon.prototype, "contains", { configurable: true, get: (): typeof Polygon.prototype.contains => {
    containsGetterReads++
    return containsDescriptor.value as typeof Polygon.prototype.contains
  } })
  try {
    expect(canUseExpectedPortsMemo(toleranceCircuit)).toBe(false)
    expect(containsGetterReads).toBe(0)
    const nativeResult = nativeContinuityChecker(toleranceCircuit)
    const nativeReads = containsGetterReads
    containsGetterReads = 0
    deepStrictEqual(toleranceChecker(toleranceCircuit), nativeResult)
    expect(containsGetterReads).toBe(nativeReads)
    expect(nativeReads).toBeGreaterThan(0)
  } finally { Object.defineProperty(Polygon.prototype, "contains", containsDescriptor) }

  const bounded = new ScaledConductorPolygonMemo(2, 4)
  let attempts = 0
  for (let repeat = 0; repeat < 2; repeat++) {
    let thrown: unknown
    try { bounded.getOrCreate(1, (): never => { attempts++; throw failure }) } catch (error) { thrown = error }
    strictEqual(thrown, failure)
  }
  expect(attempts).toBe(2)
  expect(bounded.diagnostics.entries).toBe(0)
  const empty = (): Polygon => new Polygon()
  expect(bounded.getOrCreate(1, empty)).toBeUndefined()
  expect(bounded.getOrCreate(1, (): never => { throw failure })).toBeUndefined()
  bounded.getOrCreate(2, (): Polygon => circlePolygon({ x: -0, y: 0 }, 0.1))
  bounded.getOrCreate(3, (): Polygon => new Polygon(new Box(-1, -1, 1, 1)))
  expect(bounded.diagnostics.entries).toBeLessThanOrEqual(2)
  expect(bounded.diagnostics.edges).toBeLessThanOrEqual(4)
  expect(bounded.diagnostics.evictions).toBeGreaterThan(0)

  const contact = createCopperPolygonContactTester(0.1)
  const constructors: Array<() => Polygon> = [
    (): Polygon => circlePolygon({ x: -0, y: 0 }, 0.1),
    (): Polygon => getTraceSegmentPolygon({ x: -1, y: 0 }, { x: 1, y: 0 }, 0.1),
    (): Polygon => getPourPolygon(pour),
  ]
  const stable = new ScaledConductorPolygonMemo()
  const shapes = constructors.map((construct, i) => stable.getOrCreate(i + 1, construct)!)
  const snapshots = shapes.map(geometrySnapshot)
  for (let repeat = 0; repeat < 4; repeat++) {
    for (const a of shapes) for (const b of shapes) {
      contact(a, b)
      a.contains(new Point(0, 0))
      a.edges.search(a.box)
    }
  }
  deepStrictEqual(shapes.map(geometrySnapshot), snapshots)
  for (let i = 0; i < constructors.length; i++) {
    strictEqual(stable.getOrCreate(i + 1, (): never => { throw failure }), shapes[i])
    deepStrictEqual(geometrySnapshot(shapes[i]!), geometrySnapshot(constructors[i]!().scale(1e6, 1e6)))
  }
})
