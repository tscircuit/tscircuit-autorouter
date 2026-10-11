import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { RelaxTraceClearanceSolver, type RelaxTraceClearanceInput } from "@tscircuit/repair04"
import type { HighDensityRoute } from "high-density-repair03/lib"
import {
  Pipeline9IndexedRelaxTraceClearanceSolver,
  type ProjectionBatchExecutor,
  type ProjectionSweepGeometry,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9IndexedRelaxTraceClearanceSolver"
import { Pipeline9WasmRelaxTraceClearanceSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9WasmRelaxTraceClearanceSolver"
import { projectionInput } from "../fixtures/repair04StepFixtures"

type Point = { x: number; y: number }
type Vertex = Point & {
  original: Point
  locked: boolean
  radius: number
  revision: number
  bounds: RelaxTraceClearanceInput["bounds"]
  points: HighDensityRoute["route"]
}
type ProjectionState = {
  phase: string
  routes: HighDensityRoute[]
  vertices: Map<string, Vertex>
  pairs: unknown[]
  padContacts: unknown[]
  segments: Array<{ boundsCache?: object }>
  pairOuterIndex: number
  pairInnerIndex: number
  obstacleIndex: number
  sweepIndex: number
  sweepPairIndex: number
  sweepPadIndex: number
  preparedPairCount: number
  projectedConstraintCount: number
  getViaPadDistance: (...args: unknown[]) => number
}
type ProjectionSolver = RelaxTraceClearanceSolver | Pipeline9IndexedRelaxTraceClearanceSolver

class FaultInjectedWasmProjection extends Pipeline9WasmRelaxTraceClearanceSolver {
  readonly proposed: Point[] = []

  constructor(input: RelaxTraceClearanceInput, private readonly fault: Error) {
    super(input)
  }

  protected override createProjectionBatchExecutor(
    geometry: ProjectionSweepGeometry,
  ): ProjectionBatchExecutor | undefined {
    return super.createProjectionBatchExecutor({
      ...geometry,
      projectVertex: (_vertex, x, y): never => {
        this.proposed.push({ x, y })
        throw this.fault
      },
    })
  }
}

function snapshot(solver: ProjectionSolver): object {
  const state = solver as unknown as ProjectionState
  return {
    phase: state.phase,
    routes: state.routes,
    vertices: [...state.vertices].map(([key, vertex]) => ({ key, ...vertex })),
    pairCount: state.pairs.length,
    padCount: state.padContacts.length,
    pairOuterIndex: state.pairOuterIndex,
    pairInnerIndex: state.pairInnerIndex,
    obstacleIndex: state.obstacleIndex,
    sweepIndex: state.sweepIndex,
    sweepPairIndex: state.sweepPairIndex,
    sweepPadIndex: state.sweepPadIndex,
    preparedPairCount: state.preparedPairCount,
    projectedConstraintCount: state.projectedConstraintCount,
    iterations: solver.iterations,
    maximumIterations: solver.MAX_ITERATIONS,
    stats: solver.stats,
    progress: solver.progress,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
  }
}

function route(name: string, points: HighDensityRoute["route"], root?: string): HighDensityRoute {
  return { connectionName: name, ...(root ? { rootConnectionName: root } : {}),
    traceThickness: .1, viaDiameter: .3, vias: [], route: points }
}

function inputFor(routes: HighDensityRoute[], obstacles: RelaxTraceClearanceInput["srj"]["obstacles"] = []): RelaxTraceClearanceInput {
  const bounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
  return { srj: { bounds, layerCount: 2, minTraceWidth: .1, connections: [], obstacles },
    routes, bounds, boundaryMargin: .02, traceClearance: .1, viaClearance: .1,
    lockedPointIndices: routes.map((item) => item.route.map((_, index) => index === 0 || index === item.route.length - 1)),
    allowViaMovement: true, boardEdgeClearance: .08 }
}

function compareAllSteps(input: RelaxTraceClearanceInput, label: string): Pipeline9WasmRelaxTraceClearanceSolver {
  const before = structuredClone(input)
  const native = new RelaxTraceClearanceSolver(input)
  const wasm = new Pipeline9WasmRelaxTraceClearanceSolver(input)
  while (!native.solved && !native.failed) {
    native.step()
    wasm.step()
    deepStrictEqual(snapshot(wasm), snapshot(native), `${label}, step ${native.iterations}`)
  }
  expect(wasm.failed).toBeFalse()
  deepStrictEqual(wasm.getOutput(), native.getOutput(), label)
  expect(wasm.getOutput()).toBe(wasm.getOutput())
  expect(wasm.getOutput()).not.toBe(input.routes)
  expect(wasm.getOutput()[0]).not.toBe(input.routes[0])
  expect(wasm.getOutput()[0]!.route).not.toBe(input.routes[0]!.route)
  deepStrictEqual(input, before)
  return wasm
}

function preparedPair(
  input: RelaxTraceClearanceInput,
): [Pipeline9IndexedRelaxTraceClearanceSolver, Pipeline9WasmRelaxTraceClearanceSolver] {
  const javascript = new Pipeline9IndexedRelaxTraceClearanceSolver(input)
  const wasm = new Pipeline9WasmRelaxTraceClearanceSolver(input)
  while ((javascript as unknown as ProjectionState).phase !== "sweeps") {
    javascript.step()
    wasm.step()
  }
  for (let sweep = 0; sweep < 3; sweep++) {
    javascript.step()
    wasm.step()
    deepStrictEqual(snapshot(wasm), snapshot(javascript))
  }
  expect(wasm.kernelDiagnostics.enabled).toBeTrue()
  return [javascript, wasm]
}

function cachedContacts(solver: ProjectionSolver): object {
  type CachedPair = { revisions: number[]; contact: object | null; separated: boolean; weights: [Vertex, number][] }
  type CachedPad = { revisions: number[]; contact: object | null; interiorRevisions: number[]; interiors: (object | null)[]; weights: [Vertex, number][] }
  const state = solver as unknown as ProjectionState
  return {
    pairs: (state.pairs as CachedPair[]).map((pair) => ({
      revisions: pair.revisions, contact: pair.contact, separated: pair.separated,
      weights: pair.weights.map((entry) => entry[1]),
    })),
    pads: (state.padContacts as CachedPad[]).map((pad) => ({
      revisions: pad.revisions, contact: pad.contact,
      interiorRevisions: pad.interiorRevisions, interiors: pad.interiors,
      weights: pad.weights.map((entry) => entry[1]),
    })),
    bounds: state.segments.map((segment) => segment.boundsCache),
  }
}

test("WASM projection preserves every native batch, mutable vertex, physical guard and independent instance", (): void => {
  const base = structuredClone(projectionInput) as RelaxTraceClearanceInput
  const shared = inputFor([
    route("sameA", [{ x: -1, y: 0, z: 0 }, { x: -0, y: 0, z: 0 }, { x: .7, y: 0, z: 0 }], "same"),
    route("sameB", [{ x: -0, y: 0, z: 0 }, { x: .35, y: .05, z: 0 }, { x: 1, y: .1, z: 0 }], "same"),
    route("foreign", [{ x: -1, y: .12, z: 0 }, { x: .1, y: .12, z: 0 }, { x: 1, y: .12, z: 0 }]),
    route("crossing", [{ x: -.1, y: -1, z: 0 }, { x: -.1, y: -.1, z: 0 }, { x: -.1, y: 1, z: 0 }]),
  ])
  const guarded = inputFor([
    route("a", [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]),
    route("b", [{ x: -1, y: .06, z: 0 }, { x: 0, y: .06, z: 0 }, { x: 1, y: .06, z: 0 }]),
    route("via", [{ x: -1, y: .12, z: 0 }, { x: .1, y: .12, z: 0 }, { x: .1, y: .12, z: 1 }, { x: 1, y: .12, z: 1 }]),
  ], [
    { type: "rect", center: { x: .1, y: .22 }, width: .3, height: .25,
      ccwRotationDegrees: 27, layers: ["top", "bottom"], connectedTo: ["foreign_pad"] },
    { type: "oval", center: { x: -.15, y: .12 }, width: .42, height: .18,
      ccwRotationDegrees: -31, layers: ["top", "bottom"], connectedTo: ["foreign_oval"] },
  ])
  const collapsed = inputFor([
    route("zero", [{ x: -1, y: -0, z: 0 }, { x: -0, y: -0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]),
    route("tiny", [{ x: -1, y: Number.MIN_VALUE, z: 0 }, { x: 0, y: Number.MIN_VALUE, z: 0 }, { x: 1, y: Number.MIN_VALUE, z: 0 }]),
    route("near", [{ x: -1, y: .1, z: 0 }, { x: 0, y: .1, z: 0 }, { x: 1, y: .1, z: 0 }]),
  ], [{ type: "rect", center: { x: 0, y: 0 }, width: 0, height: 0, layers: ["top"], connectedTo: ["point_pad"] }])
  const clipped = inputFor([
    route("clipA", [{ x: -1, y: 1.7, z: 0 }, { x: 0, y: 1.94, z: 0 }, { x: 1, y: 1.7, z: 0 }]),
    route("clipB", [{ x: -1, y: 1.72, z: 0 }, { x: 0, y: 1.96, z: 0 }, { x: 1, y: 1.72, z: 0 }]),
  ], [{ type: "rect", center: { x: 0, y: 1.92 }, width: .4, height: .4, layers: ["top"], connectedTo: ["square_tie"] }])
  const wide = inputFor(Array.from({ length: 60 }, (_, index) => route(`wide${index}`, [
    { x: -1, y: index * .0003, z: 0 },
    { x: 0, y: index * .0003, z: 0 },
    { x: 1, y: index * .0003, z: 0 },
  ])))
  let randomState = 0x3985ac13
  const random = (): number => {
    randomState ^= randomState << 13
    randomState ^= randomState >>> 17
    randomState ^= randomState << 5
    return (randomState >>> 0) / 0x100000000
  }
  const fixtures = [base, shared, guarded, collapsed, clipped, wide]
  for (let sample = 0; sample < 16; sample++) {
    const routes = Array.from({ length: 4 }, (_, index) => {
      const y = (index - 2) * .07 + (random() - .5) * .04
      const x = (random() - .5) * .25
      return route(`random${sample}_${index}`, [
        { x: -1, y, z: index % 2 },
        { x, y: y + (random() - .5) * .12, z: index % 2 },
        { x: 1, y, z: index % 2 },
      ])
    })
    const input = inputFor(routes, [{ type: sample % 2 === 0 ? "rect" : "oval",
      center: { x: (random() - .5) * .2, y: (random() - .5) * .2 },
      width: .2 + random() * .2, height: .1 + random() * .1,
      ccwRotationDegrees: sample * 17, layers: ["top", "bottom"], connectedTo: [`pad${sample}`] }])
    input.lockedPointIndices[0]![1] = sample % 3 === 0
    fixtures.push(input)
  }
  let guardCalls = 0
  let changed = 0
  for (const [index, input] of fixtures.entries()) {
    const wasm = compareAllSteps(input, `fixture ${index}`)
    expect(wasm.kernelDiagnostics.enabled).toBeTrue()
    expect(wasm.kernelDiagnostics.batches).toBeGreaterThanOrEqual(256)
    guardCalls += wasm.kernelDiagnostics.guardCalls
    if (JSON.stringify(wasm.getOutput()) !== JSON.stringify(input.routes)) changed++
    if (input === wide) expect(wasm.kernelDiagnostics.batches).toBeGreaterThan(256)
  }
  expect(guardCalls).toBeGreaterThan(0)
  expect(changed).toBeGreaterThan(4)

  const outside = structuredClone(shared)
  for (const item of outside.routes) for (const point of item.route) point.x += 20_000
  outside.bounds = { ...outside.bounds, minX: outside.bounds.minX + 20_000, maxX: outside.bounds.maxX + 20_000 }
  outside.srj.bounds = outside.bounds
  const unsupported = compareAllSteps(outside, "outside finite kernel domain")
  expect(unsupported.kernelDiagnostics.enabled).toBeFalse()
  expect(unsupported.kernelDiagnostics.batches).toBe(0)
  expect(unsupported.kernelDiagnostics.fallbackReason).toBe("outside finite native kernel domain")

  const nativeA = new RelaxTraceClearanceSolver(shared)
  const nativeB = new RelaxTraceClearanceSolver(guarded)
  const wasmA = new Pipeline9WasmRelaxTraceClearanceSolver(shared)
  const wasmB = new Pipeline9WasmRelaxTraceClearanceSolver(guarded)
  while (!nativeA.solved || !nativeB.solved) {
    for (const [native, wasm] of [[nativeA, wasmA], [nativeB, wasmB]] as const) {
      if (native.solved) continue
      native.step()
      wasm.step()
      deepStrictEqual(snapshot(wasm), snapshot(native), "interleaved independent kernel")
    }
  }
  const secondOutput = structuredClone(wasmB.getOutput())
  const originalInput = structuredClone(shared.routes)
  wasmA.getOutput()[0]!.route[1]!.x += .123
  deepStrictEqual(wasmB.getOutput(), secondOutput)
  deepStrictEqual(shared.routes, originalInput)
  expect(wasmA.getOutput()).not.toBe(wasmB.getOutput())

  const javascript = new Pipeline9IndexedRelaxTraceClearanceSolver(guarded)
  const throwingWasm = new Pipeline9WasmRelaxTraceClearanceSolver(guarded)
  const guardError = new RangeError("exact physical guard exception")
  for (const solver of [javascript, throwingWasm]) {
    const state = solver as unknown as ProjectionState
    while (state.phase !== "sweeps") solver.step()
    state.getViaPadDistance = (): never => { throw guardError }
  }
  const beforeThrow = structuredClone(snapshot(javascript))
  const capture = (solver: ProjectionSolver): unknown => {
    try { solver.step() } catch (error) { return error }
    throw new Error("Expected original physical guard failure")
  }
  expect(capture(javascript)).toBe(guardError)
  expect(capture(throwingWasm)).toBe(guardError)
  const javascriptSnapshot = snapshot(javascript) as Record<string, unknown>
  const wasmSnapshot = snapshot(throwingWasm) as Record<string, unknown>
  // BaseSolver's error text includes the concrete adapter class name.
  expect(wasmSnapshot.error).toBe(String(javascriptSnapshot.error).replace(
    "Pipeline9IndexedRelaxTraceClearanceSolver", "Pipeline9WasmRelaxTraceClearanceSolver",
  ))
  delete javascriptSnapshot.error
  delete wasmSnapshot.error
  deepStrictEqual(wasmSnapshot, javascriptSnapshot, "partial batch and cursor before guard exception")
  expect(snapshot(javascript)).not.toEqual(beforeThrow)
  expect([...(javascript as unknown as ProjectionState).vertices.values()].some((vertex) => vertex.revision > 0)).toBeTrue()
  expect(throwingWasm.kernelDiagnostics.enabled).toBeFalse()
  expect(throwingWasm.kernelDiagnostics.guardCalls).toBe(0)

  const faultJavascript = new Pipeline9IndexedRelaxTraceClearanceSolver(guarded)
  const faultWasm = new FaultInjectedWasmProjection(guarded, guardError)
  for (const solver of [faultJavascript, faultWasm]) {
    while ((solver as unknown as ProjectionState).phase !== "sweeps") solver.step()
  }
  const nativeProposed: Point[] = []
  ;(faultJavascript as unknown as ProjectionState).getViaPadDistance = (point): never => {
    nativeProposed.push(point as Point)
    throw guardError
  }
  expect(capture(faultJavascript)).toBe(guardError)
  expect(capture(faultWasm)).toBe(guardError)
  const nativeFaultSnapshot = snapshot(faultJavascript) as Record<string, unknown>
  const wasmFaultSnapshot = snapshot(faultWasm) as Record<string, unknown>
  expect(wasmFaultSnapshot.error).toBe(String(nativeFaultSnapshot.error).replace(
    "Pipeline9IndexedRelaxTraceClearanceSolver", "FaultInjectedWasmProjection",
  ))
  delete nativeFaultSnapshot.error
  delete wasmFaultSnapshot.error
  deepStrictEqual(wasmFaultSnapshot, nativeFaultSnapshot, "partial native batch at WASM bridge exception")
  deepStrictEqual(faultWasm.proposed, nativeProposed)
  expect([...(faultJavascript as unknown as ProjectionState).vertices.values()].some((vertex) => vertex.revision > 0)).toBeTrue()
  expect(faultWasm.kernelDiagnostics.enabled).toBeTrue()
  expect(faultWasm.kernelDiagnostics.guardCalls).toBeGreaterThan(0)

  type ProjectOverride = { projectVertex: (vertex: Vertex, x: number, y: number, tangents: boolean) => void }
  const observedJavascript = new Pipeline9IndexedRelaxTraceClearanceSolver(shared)
  const observedWasm = new Pipeline9WasmRelaxTraceClearanceSolver(shared)
  const events: object[][] = [[], []]
  for (const [index, solver] of [observedJavascript, observedWasm].entries()) {
    const state = solver as unknown as ProjectionState & ProjectOverride
    const original = state.projectVertex.bind(solver)
    state.projectVertex = (vertex, x, y, tangents): void => {
      events[index]!.push({ x, y, tangents,
        vertices: [...state.vertices.values()].map((item) => ({ x: item.x, y: item.y, revision: item.revision })),
      })
      original(vertex, x, y, tangents)
    }
  }
  while (!observedJavascript.solved) {
    observedJavascript.step()
    observedWasm.step()
    deepStrictEqual(snapshot(observedWasm), snapshot(observedJavascript), "observable projectVertex override")
  }
  deepStrictEqual(events[1], events[0])
  expect(events[0]!.length).toBeGreaterThan(0)
  expect(observedWasm.kernelDiagnostics.enabled).toBeFalse()
  expect(observedWasm.kernelDiagnostics.fallbackReason).toBe("custom native projectVertex hook")

  const lockedInput = structuredClone(base)
  lockedInput.lockedPointIndices = lockedInput.routes.map((item) => item.route.map(() => true))
  const getterJavascript = new Pipeline9IndexedRelaxTraceClearanceSolver(lockedInput)
  const getterWasm = new Pipeline9WasmRelaxTraceClearanceSolver(lockedInput)
  const getterCalls = [0, 0]
  for (const [index, solver] of [getterJavascript, getterWasm].entries()) {
    const state = solver as unknown as ProjectOverride
    const original = state.projectVertex.bind(solver)
    Object.defineProperty(state, "projectVertex", {
      get: (): typeof original => { getterCalls[index]++; return original },
    })
  }
  while (!getterJavascript.solved) {
    getterJavascript.step()
    getterWasm.step()
    deepStrictEqual(snapshot(getterWasm), snapshot(getterJavascript), "native hook getter eligibility")
  }
  expect(getterCalls).toEqual([0, 0])
  expect(getterWasm.kernelDiagnostics.enabled).toBeFalse()
  expect(getterWasm.kernelDiagnostics.fallbackReason).toBe("custom native projectVertex hook")

  const [sqrtJavascript, sqrtWasm] = preparedPair(guarded)
  const sqrtDescriptor = Object.getOwnPropertyDescriptor(Math, "sqrt")!
  const originalSqrt = Math.sqrt
  const sqrtEvents: number[][] = [[], []]
  let active = 0
  try {
    Object.defineProperty(Math, "sqrt", { ...sqrtDescriptor, value: (value: number): number => {
      sqrtEvents[active]!.push(value)
      return originalSqrt(value)
    } })
    for (let step = 0; step < 6; step++) {
      active = 0
      sqrtJavascript.step()
      active = 1
      sqrtWasm.step()
      deepStrictEqual(snapshot(sqrtWasm), snapshot(sqrtJavascript), "mid-sweep sqrt replacement")
      deepStrictEqual(cachedContacts(sqrtWasm), cachedContacts(sqrtJavascript), "restored native cached contacts")
    }
  } finally {
    Object.defineProperty(Math, "sqrt", sqrtDescriptor)
  }
  deepStrictEqual(sqrtEvents[1], sqrtEvents[0])
  expect(sqrtEvents[0]!.length).toBeGreaterThan(0)
  expect(sqrtWasm.kernelDiagnostics.enabled).toBeFalse()
  expect(sqrtWasm.kernelDiagnostics.fallbackReason).toBe("native execution changed between batches")

  const [methodJavascript, methodWasm] = preparedPair(guarded)
  const methodEvents: object[][] = [[], []]
  for (const [index, solver] of [methodJavascript, methodWasm].entries()) {
    const state = solver as unknown as ProjectionState
    const original = state.getViaPadDistance.bind(solver)
    state.getViaPadDistance = (...args): number => {
      methodEvents[index]!.push({ point: args[0],
        vertices: [...state.vertices.values()].map((vertex) => ({ x: vertex.x, y: vertex.y, revision: vertex.revision })),
      })
      return original(...args)
    }
  }
  for (let step = 0; step < 6; step++) {
    methodJavascript.step()
    methodWasm.step()
    deepStrictEqual(snapshot(methodWasm), snapshot(methodJavascript), "mid-sweep physical method replacement")
    deepStrictEqual(cachedContacts(methodWasm), cachedContacts(methodJavascript))
  }
  deepStrictEqual(methodEvents[1], methodEvents[0])
  expect(methodEvents[0]!.length).toBeGreaterThan(0)
  expect(methodWasm.kernelDiagnostics.enabled).toBeFalse()
  expect(methodWasm.kernelDiagnostics.fallbackReason).toBe("native execution changed between batches")
})
