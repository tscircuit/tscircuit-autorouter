import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA03Solver"
import { installParallelNativeA01Heap, prepareParallelNativeA01Heap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelNativeA01Heap"
import { installParallelNativeA03Geometry, prepareParallelNativeA03Geometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelNativeA03Geometry"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "tests/fixtures/parallel-grid-history-cmn45.json"

type Heap = { f: number[]; seq: number[]; id: number[]; n: number;
  push(f: number, seq: number, id: number): void; pop(): number }
type A03View = { computeH(z: number, cell: number, toZ: number, goal: number): number;
  fillViaOccupants(cell: number, active: number): void; viaOccupantsByCell: Map<number, readonly number[]> }

function createA01(): ReplayHighDensityA01Solver {
  const solver = new ReplayHighDensityA01Solver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    cellSizeMm: 0.1, viaDiameter: 0.3, traceThickness: 0.1,
    viaMinDistFromBorder: 0.15, traceMargin: 0.1, hyperParameters: { shuffleSeed: 0 } })
  solver.setup()
  expect(solver.failed).toBe(false)
  expect(Object.hasOwn(readHeap(solver), "push")).toBe(false)
  installParallelNativeA01Heap(solver, { prototype: ReplayHighDensityA01Solver.prototype,
    descriptors: Object.getOwnPropertyDescriptors(ReplayHighDensityA01Solver.prototype) })
  return solver
}

function createA03(optIn: boolean): ReplayHighDensityA03Solver {
  const solver = new ReplayHighDensityA03Solver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    highResolutionCellSize: 0.1, highResolutionCellThickness: 8,
    lowResolutionCellSize: 0.4, viaDiameter: 0.3, traceThickness: 0.1,
    viaMinDistFromBorder: 0.15, traceMargin: 0.1 }, { immutableWorkerGeometry: optIn })
  solver.setup()
  expect(solver.failed).toBe(false)
  expect(Object.hasOwn(solver, "computeH")).toBe(false)
  if (optIn) installParallelNativeA03Geometry(solver, { prototype: ReplayHighDensityA03Solver.prototype,
    descriptors: Object.getOwnPropertyDescriptors(ReplayHighDensityA03Solver.prototype) })
  return solver
}

function readHeap(solver: object): Heap {
  const descriptor = Object.getOwnPropertyDescriptor(solver, "heap")
  expect(descriptor).toBeDefined()
  expect(descriptor!.get).toBeUndefined()
  const heap = descriptor!.value as Heap
  return heap
}

test("owner kernels preserve default native lookup, late getter/errors, aliases, identities and repeated native setup", (): void => {
  const plain = createA03(false)
  expect(plain instanceof HighDensitySolverA03).toBe(true)
  expect(Object.hasOwn(plain, "computeH")).toBe(false)
  expect(Object.hasOwn(plain, "fillViaOccupants")).toBe(false)
  const memo = createA03(true)
  expect(Object.hasOwn(memo, "computeH")).toBe(true)
  const originalHeap = readHeap(memo), originalCenters = memo.cellCenterX
  const originalOwnerCache = (memo as unknown as A03View).viaOccupantsByCell
  memo._setup()
  installParallelNativeA03Geometry(memo, { prototype: ReplayHighDensityA03Solver.prototype,
    descriptors: Object.getOwnPropertyDescriptors(ReplayHighDensityA03Solver.prototype) })
  expect(memo.cellCenterX).not.toBe(originalCenters)
  expect(readHeap(memo)).not.toBe(originalHeap)
  expect((memo as unknown as A03View).viaOccupantsByCell).toBe(originalOwnerCache)
  expect(Object.hasOwn(memo, "computeH")).toBe(true)
  expect(Object.keys(memo).includes("computeH")).toBe(false)
  expect(Object.keys(memo).includes("fillViaOccupants")).toBe(false)
  const view = memo as unknown as A03View
  // Direct calls remain native and therefore see even in-place geometry changes.
  const originalX = memo.cellCenterX[0]!
  memo.cellCenterX[0] = originalX + 0.25
  expect(view.computeH(0, 0, 1, 1)).toBe(Math.hypot(memo.cellCenterX[0]! - memo.cellCenterX[1]!,
    memo.cellCenterY[0]! - memo.cellCenterY[1]!) + memo.hyperParameters.viaBaseCost)
  memo.cellCenterX[0] = originalX
  let policyGets = 0
  Object.defineProperty(memo.hyperParameters, "viaBaseCost", { configurable: true,
    get(): number { policyGets++; return 0.125 } })
  prepareParallelNativeA03Geometry(memo)
  expect(policyGets).toBe(0)
  expect(Object.hasOwn(memo, "computeH")).toBe(false)
  expect(view.computeH(0, 0, 1, 1)).toBe(Math.hypot(memo.cellCenterX[0]! - memo.cellCenterX[1]!,
    memo.cellCenterY[0]! - memo.cellCenterY[1]!) + 0.125)
  expect(policyGets).toBe(1)

  const owner = createA01(), heap = readHeap(owner), heapPrototype = Object.getPrototypeOf(heap)
  expect(owner instanceof HighDensitySolverA01).toBe(true)
  const originalPush = Object.getOwnPropertyDescriptor(heapPrototype, "push")!.value as Heap["push"]
  let pushCalls = 0
  heap.push = function (f: number, seq: number, id: number): void {
    pushCalls++
    originalPush.call(this, f, seq, id)
  }
  prepareParallelNativeA01Heap(owner)
  expect(Object.hasOwn(heap, "pop")).toBe(false)
  expect(Object.hasOwn(heap, "push")).toBe(true)
  heap.push(2, 3, 4)
  expect(pushCalls).toBe(1)
  expect(readHeap(owner)).toBe(heap)

  // An unvisited private accessor is not evaluated by the eligibility guard.
  const getterOwner = createA01(), getterHeap = readHeap(getterOwner)
  let lessGets = 0
  const less = Object.getOwnPropertyDescriptor(heapPrototype, "less")!.value
  Object.defineProperty(getterHeap, "less", { configurable: true,
    get(): unknown { lessGets++; return less } })
  prepareParallelNativeA01Heap(getterOwner)
  expect(lessGets).toBe(0)
  expect(Object.hasOwn(getterHeap, "push")).toBe(false)
  getterHeap.push(0, 0, 0)
  getterHeap.push(1, 1, 1)
  expect(lessGets).toBe(1)

  // Later prototype helpers and direct calls keep the original receiver/error.
  const late = createA03(true)
  const descriptor = Object.getOwnPropertyDescriptor(HighDensitySolverA03.prototype, "computeH")!
  let gets = 0
  try {
    Object.defineProperty(HighDensitySolverA03.prototype, "computeH", { configurable: true,
      get(this: HighDensitySolverA03): never {
        expect(this).toBe(late)
        gets++
        throw new Error("native late heuristic getter")
      } })
    prepareParallelNativeA03Geometry(late)
    expect(gets).toBe(0)
    expect(Object.hasOwn(late, "computeH")).toBe(false)
    expect(() => (late as unknown as A03View).computeH(0, 0, 0, 1)).toThrow("native late heuristic getter")
    expect(gets).toBe(1)
  } finally {
    Object.defineProperty(HighDensitySolverA03.prototype, "computeH", descriptor)
  }

  const direct = createA03(true)
  const directMethod = function (this: HighDensitySolverA03): number {
    expect(this).toBe(direct)
    return 123
  }
  Object.defineProperty(directMethod, "call", { get(): never { throw new Error("extra method.call observation") } })
  try {
    Object.defineProperty(HighDensitySolverA03.prototype, "computeH", { ...descriptor, value: directMethod })
    // The installed inactive wrapper resolves the current native method with
    // the original receiver, without evaluating its unrelated .call getter.
    expect((direct as unknown as A03View).computeH(0, 0, 0, 1)).toBe(123)
  } finally {
    Object.defineProperty(HighDensitySolverA03.prototype, "computeH", descriptor)
  }

  const mathOwner = createA03(true)
  const hypotDescriptor = Object.getOwnPropertyDescriptor(Math, "hypot")!
  let hypotGets = 0
  try {
    Object.defineProperty(Math, "hypot", { configurable: true,
      get(): never { hypotGets++; throw new Error("native hypot getter") } })
    prepareParallelNativeA03Geometry(mathOwner)
    expect(hypotGets).toBe(0)
    expect(Object.hasOwn(mathOwner, "computeH")).toBe(false)
    expect(() => (mathOwner as unknown as A03View).computeH(0, 0, 0, 1)).toThrow("native hypot getter")
    expect(hypotGets).toBe(1)
  } finally {
    Object.defineProperty(Math, "hypot", hypotDescriptor)
  }

  const lateStep = createA01()
  const stepDescriptor = Object.getOwnPropertyDescriptor(HighDensitySolverA01.prototype, "stepOnce")!
  let stepGets = 0
  try {
    Object.defineProperty(HighDensitySolverA01.prototype, "stepOnce", { configurable: true,
      get(): never { stepGets++; throw new Error("native late search getter") } })
    prepareParallelNativeA01Heap(lateStep)
    expect(stepGets).toBe(0)
    expect(Object.hasOwn(readHeap(lateStep), "push")).toBe(false)
    expect(() => lateStep.step()).toThrow("native late search getter")
    expect(stepGets).toBe(1)
    expect(lateStep.failed).toBe(true)
    expect(lateStep.error).toBe("HighDensitySolverA01 error: Error: native late search getter")
  } finally {
    Object.defineProperty(HighDensitySolverA01.prototype, "stepOnce", stepDescriptor)
  }

  // Direct Replay has no trusted ownership and must retain native observers.
  const callbackParams = { nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    cellSizeMm: 0.1, viaDiameter: 0.3, traceThickness: 0.1,
    viaMinDistFromBorder: 0.15, traceMargin: 0.1 }
  const callbackNative = new HighDensitySolverA01(structuredClone(callbackParams))
  const callbackReplay = new ReplayHighDensityA01Solver(structuredClone(callbackParams))
  callbackNative.setup()
  callbackReplay.setup()
  for (let index = 0; index < 10; index++) { callbackNative.step(); callbackReplay.step() }
  expect(Object.hasOwn(readHeap(callbackReplay), "push")).toBe(false)
  const minDescriptor = Object.getOwnPropertyDescriptor(Math, "min")!, nativeMin = Math.min
  const callbackCounts: number[][] = []
  for (const solver of [callbackNative, callbackReplay]) {
    let minCalls = 0, lessCalls = 0
    const sentinel = new Error("native comparator callback sentinel"), callbackHeap = readHeap(solver)
    try {
      Object.defineProperty(Math, "min", { ...minDescriptor, value: (...values: number[]): number => {
        minCalls++
        Object.defineProperty(callbackHeap, "less", { configurable: true, value: (): never => {
          lessCalls++
          throw sentinel
        } })
        return nativeMin(...values)
      } })
      expect(() => solver.step()).toThrow(sentinel.message)
    } finally { Object.defineProperty(Math, "min", minDescriptor) }
    callbackCounts.push([minCalls, lessCalls])
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain(sentinel.message)
  }
  expect(callbackCounts[1]).toEqual(callbackCounts[0])
  expect(callbackReplay.iterations).toBe(callbackNative.iterations)

  // A custom native setup remains exactly one setup and receives no installer.
  class CustomA01 extends ReplayHighDensityA01Solver {
    setupCalls = 0
    override _setup(): void {
      this.setupCalls++
      super._setup()
    }
  }
  const custom = new CustomA01({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    cellSizeMm: 0.1, viaDiameter: 0.3 })
  custom.setup()
  expect(custom.setupCalls).toBe(1)
  expect(Object.hasOwn(readHeap(custom), "push")).toBe(false)
})
