import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { WorkerHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/high-density-a01-fork/WorkerHighDensityA01Solver"

type HeapSurface = {
  push(f: number, seq: number, id: number): void
  pop(): number
  clear(): void
  readonly size: number
  f: number[]
  seq: number[]
  id: number[]
  n: number
}

function encodeHeapNumber(value: number): number | string {
  if (Number.isNaN(value)) return "NaN"
  if (Object.is(value, -0)) return "negativeZero"
  if (value === Infinity) return "positiveInfinity"
  if (value === -Infinity) return "negativeInfinity"
  return value
}

function readHeapState(heap: HeapSurface): Record<string, unknown> {
  return {
    f: heap.f.map(encodeHeapNumber), seq: heap.seq.map(encodeHeapNumber),
    id: heap.id.map(encodeHeapNumber), n: heap.n,
    fLength: heap.f.length, seqLength: heap.seq.length, idLength: heap.id.length,
  }
}

test("fused A01 heap matches all native active and stale array slots under ties and IEEE values", (): void => {
  const params = { nodeWithPortPoints: { capacityMeshNodeId: "heap-oracle", center: { x: 0, y: 0 },
    width: 2, height: 2, availableZ: [0, 7], portPoints: [] }, cellSizeMm: 0.1, viaDiameter: 0.3 }
  const native = new HighDensitySolverA01(structuredClone(params))
  const worker = new WorkerHighDensityA01Solver(structuredClone(params))
  native.setup()
  worker.setup()
  const nativeHeap = Object.getOwnPropertyDescriptor(native, "heap")!.value as HeapSurface
  const workerHeap = Object.getOwnPropertyDescriptor(worker, "heap")!.value as HeapSurface
  let randomState = 0x97045abc
  const priorities = [0, -0, 1, -1, 3.5, -2.25, Infinity, -Infinity, Number.NaN]
  const sequences = [0, -0, 1, -1, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER, Infinity, -Infinity, Number.NaN]
  let pushes = 0
  let pops = 0
  for (let operation = 0; operation < 60_000; operation++) {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    if (operation % 997 === 0) {
      nativeHeap.clear()
      workerHeap.clear()
    } else if (nativeHeap.size > 0 && (nativeHeap.size > 384 || randomState % 7 < 3)) {
      const expected = nativeHeap.pop()
      const actual = workerHeap.pop()
      expect(Object.is(actual, expected)).toBe(true)
      pops++
    } else {
      const f = priorities[(randomState >>> 7) % priorities.length]!
      const seq = operation % 2 === 0 ? operation : sequences[(randomState >>> 15) % sequences.length]!
      const id = operation % 19 === 0 ? -0 : operation
      nativeHeap.push(f, seq, id)
      workerHeap.push(f, seq, id)
      pushes++
    }
    expect(workerHeap.size).toBe(nativeHeap.size)
    expect(readHeapState(workerHeap)).toEqual(readHeapState(nativeHeap))
  }
  while (nativeHeap.size > 0) {
    expect(Object.is(workerHeap.pop(), nativeHeap.pop())).toBe(true)
    expect(readHeapState(workerHeap)).toEqual(readHeapState(nativeHeap))
  }
  expect(pushes).toBeGreaterThan(25_000)
  expect(pops).toBeGreaterThan(20_000)
})
