import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { ReplayHighDensityA03Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA03Solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "tests/fixtures/parallel-grid-history-cmn45.json"

type A03Params = ConstructorParameters<typeof HighDensitySolverA03>[0]
function readNativeFields(solver: object, nativeKeys: readonly string[]): Record<string, unknown> {
  const descriptors = Object.getOwnPropertyDescriptors(solver)
  const fields: Record<string, unknown> = {}
  for (const key of nativeKeys) {
    fields[key] = normalizeNativeState(descriptors[key]!.value)
  }
  return fields
}

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

function createRandomNode(seed: number): NodeWithPortPoints {
  let state = seed >>> 0
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const value = state / 0x100000000
    return value
  }
  const width = 0.8 + random() * 2.8
  const height = 0.8 + random() * 2.8
  const availableZ = seed % 3 === 0 ? [0, 3, 7] : [0, 3]
  const portPoints: NodeWithPortPoints["portPoints"] = []
  for (let connection = 0; connection < 2 + seed % 4; connection++) {
    for (let end = 0; end < 2; end++) {
      portPoints.push({ connectionName: `net_${connection}`, rootConnectionName: `root_${connection % 3}`,
        portPointId: `${connection}_${end}`, x: (end === 0 ? -0.45 : 0.45) * width,
        y: (random() - 0.5) * height * 0.9, z: availableZ[Math.floor(random() * availableZ.length)]! })
    }
  }
  return { capacityMeshNodeId: `a03_geometry_${seed}`, center: { x: 0, y: 0 },
    width, height, availableZ, portPoints }
}

test("local original A03 owner memo preserves native identity, arrays, every checkpoint, live occupants and mutable numeric policy", (): void => {
  let observedSolved = false
  let observedFailure = false
  for (let scenario = 0; scenario < 34; scenario++) {
    const node = scenario === 0 ? structuredClone(cmn45) as NodeWithPortPoints : createRandomNode(scenario)
    const params: A03Params = { nodeWithPortPoints: node,
      highResolutionCellSize: scenario % 3 === 0 ? 0.1 : 0.2,
      highResolutionCellThickness: scenario % 4 === 0 ? 8 : 2,
      lowResolutionCellSize: 0.4, viaDiameter: 0.3, viaMinDistFromBorder: 0.15,
      traceMargin: 0.1, traceThickness: 0.1, enableDiagonalMoves: scenario % 2 === 1,
      stepMultiplier: scenario % 5 === 0 && scenario !== 0 ? 3 : 1,
      hyperParameters: { shuffleSeed: scenario % 6 }, effort: 1 }
    const native = new HighDensitySolverA03(structuredClone(params))
    const worker = new ReplayHighDensityA03Solver(structuredClone(params), { immutableWorkerGeometry: true })
    native.setup()
    worker.setup()
    const heap = Object.getOwnPropertyDescriptor(worker, "heap")!.value
    const geometry = [worker.cellCenterX, worker.cellCenterY]
    expect(worker instanceof HighDensitySolverA03).toBe(true)
    expect(Object.hasOwn(worker, "computeH")).toBe(true)
    expect(Object.hasOwn(worker, "fillViaOccupants")).toBe(true)
    native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, scenario === 0 ? 160_000 : 12_000)
    worker.MAX_ITERATIONS = native.MAX_ITERATIONS
    const nativeKeys = Object.keys(native)
    expect(readNativeFields(worker, nativeKeys)).toEqual(readNativeFields(native, nativeKeys))
    while (!native.solved && !native.failed) {
      if (scenario > 0 && native.iterations % 317 === 0) {
        const values = [-0, 0.1, 0.25, -0.2, Number.NaN]
        const viaBaseCost = values[Math.floor(native.iterations / 317) % values.length]!
        native.hyperParameters.viaBaseCost = viaBaseCost
        worker.hyperParameters.viaBaseCost = viaBaseCost
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
    expect(worker.cellCenterX).toBe(geometry[0])
    expect(worker.cellCenterY).toBe(geometry[1])
    observedSolved ||= native.solved
    observedFailure ||= native.failed
    if (scenario === 0) {
      expect(native.iterations).toBe(75_624)
      expect(native.error).toBe("Convergence failure: exceeded MAX_RIPS 200")
    }
  }
  expect(observedSolved).toBe(true)
  expect(observedFailure).toBe(true)
})
