import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "tests/fixtures/parallel-grid-history-cmn45.json"

function normalizeNativeState(value: unknown): unknown {
  if (typeof value === "number" && Number.isNaN(value)) return { ieeeNumber: "NaN" }
  if (Object.is(value, -0)) return { ieeeNumber: "negativeZero" }
  if (ArrayBuffer.isView(value)) {
    return { type: value.constructor.name,
      values: Array.from(value as unknown as ArrayLike<number>, normalizeNativeState) }
  }
  if (value instanceof Map) return { mapEntries: [...value].map(normalizeNativeState) }
  if (value instanceof Set) return { setValues: [...value].map(normalizeNativeState) }
  if (Array.isArray(value)) return value.map(normalizeNativeState)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeNativeState(item)]))
  }
  return value
}

function readNativeFields(solver: object, nativeKeys: readonly string[]): Record<string, unknown> {
  const descriptors = Object.getOwnPropertyDescriptors(solver)
  const fields: Record<string, unknown> = {}
  for (const key of nativeKeys) {
    fields[key] = normalizeNativeState(descriptors[key]!.value)
  }
  return fields
}

function createRandomNode(seed: number): NodeWithPortPoints {
  let state = seed >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const value = state / 0x100000000
    return value
  }
  const width = 0.8 + random() * 2.2
  const height = 0.8 + random() * 2.2
  const availableZ = seed % 3 === 0 ? [0, 2, 8] : [0, 2]
  const portPoints: NodeWithPortPoints["portPoints"] = []
  for (let connection = 0; connection < 2 + seed % 4; connection++) {
    for (let end = 0; end < 2; end++) {
      portPoints.push({ connectionName: `net_${connection}`, rootConnectionName: `root_${connection % 3}`,
        portPointId: `${connection}_${end}`, x: (end === 0 ? -0.45 : 0.45) * width,
        y: (random() - 0.5) * height * 0.9, z: availableZ[Math.floor(random() * availableZ.length)]! })
    }
  }
  return { capacityMeshNodeId: `a01_heap_${seed}`, center: { x: 0, y: 0 },
    width, height, availableZ, portPoints }
}

test("local original A01 owner heap preserves native identity, arrays, every checkpoint and all six critical seeded searches", (): void => {
  let observedSolved = false
  let observedFailure = false
  let capturedIterations = 0
  for (let scenario = 0; scenario < 36; scenario++) {
    const captured = scenario < 6
    const node = captured ? structuredClone(cmn45) as NodeWithPortPoints : createRandomNode(scenario)
    const params = { nodeWithPortPoints: node, cellSizeMm: captured ? 0.1 : 0.15,
      viaDiameter: 0.3, viaMinDistFromBorder: 0.15, traceMargin: 0.1, traceThickness: 0.1,
      stepMultiplier: !captured && scenario % 5 === 0 ? 3 : 1,
      hyperParameters: { shuffleSeed: scenario % 6 }, effort: 1 }
    const native = new HighDensitySolverA01(structuredClone(params))
    const worker = new ReplayHighDensityA01Solver(structuredClone(params))
    native.setup()
    worker.setup()
    const nativeKeys = Object.keys(native)
    const heap = Object.getOwnPropertyDescriptor(worker, "heap")!.value
    const arrays = [heap.f, heap.seq, heap.id]
    expect(worker instanceof HighDensitySolverA01).toBe(true)
    expect(Object.hasOwn(heap, "push")).toBe(true)
    expect(Object.keys(heap)).toEqual(Object.keys(Object.getOwnPropertyDescriptor(native, "heap")!.value))
    native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, captured ? 160_000 : 12_000)
    worker.MAX_ITERATIONS = native.MAX_ITERATIONS
    expect(readNativeFields(worker, nativeKeys)).toEqual(readNativeFields(native, nativeKeys))
    while (!native.solved && !native.failed) {
      if (!captured && native.iterations % 317 === 0) {
        const values = [-0, 0.1, 0.25, -0.2, Number.NaN]
        const viaBaseCost = values[Math.floor(native.iterations / 317) % values.length]!
        native.hyperParameters.viaBaseCost = worker.hyperParameters.viaBaseCost = viaBaseCost
        native.hyperParameters.greedyMultiplier = worker.hyperParameters.greedyMultiplier =
          native.iterations % 634 === 0 ? 1.5 : 0.75
      }
      native.step()
      worker.step()
      expect(worker.iterations).toBe(native.iterations)
      expect(worker.solved).toBe(native.solved)
      expect(worker.failed).toBe(native.failed)
      if (native.iterations % 100 === 0 || native.solved || native.failed) {
        expect(readNativeFields(worker, nativeKeys)).toEqual(readNativeFields(native, nativeKeys))
        expect(worker.getOutput()).toEqual(native.getOutput())
        expect(worker.gridStats).toEqual(native.gridStats)
      }
    }
    expect(Object.getOwnPropertyDescriptor(worker, "heap")!.value).toBe(heap)
    expect(heap.f).toBe(arrays[0])
    expect(heap.seq).toBe(arrays[1])
    expect(heap.id).toBe(arrays[2])
    if (captured) {
      expect(native.iterations).toBe(scenario === 5 ? 157_175 : 160_000)
      expect(native.failed).toBe(true)
      capturedIterations += native.iterations
    }
    observedSolved ||= native.solved
    observedFailure ||= native.failed
  }
  expect(capturedIterations).toBe(957_175)
  expect(observedSolved).toBe(true)
  expect(observedFailure).toBe(true)
})
