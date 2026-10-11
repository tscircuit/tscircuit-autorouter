import { deepStrictEqual, strictEqual } from "node:assert"
import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01HeapArena, type NativeA01HeapColumns } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-heap-arena/NativeA01HeapArena"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../fixtures/parallel-grid-history-cmn45.json"

type Heap = NativeA01HeapColumns & {
  push(f: number, seq: number, id: number): void; pop(): number; clear(): void
}
function nativeFields(solver: HighDensitySolverA01, names: readonly string[]): object {
  const fields: Record<string, unknown> = {}, descriptors = Object.getOwnPropertyDescriptors(solver)
  for (let index = 0; index < names.length; index++) {
    fields[names[index]!] = descriptors[names[index]!]!.value
  }
  return fields
}

test("isolated A01 heap arena preserves all six critical native cmn45 searches and every 100-step private checkpoint", (): void => {
  let checkpoints = 0, steps = 0, hydratedRows = 0, flushedRows = 0
  for (let seed = 0; seed < 6; seed++) {
    const params = { nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
      cellSizeMm: 0.1, viaDiameter: 0.3, traceThickness: 0.1,
      viaMinDistFromBorder: 0.15, traceMargin: 0.1, effort: 1,
      hyperParameters: { shuffleSeed: seed } }
    const native = new HighDensitySolverA01(structuredClone(params))
    const owner = new HighDensitySolverA01(structuredClone(params))
    native.setup()
    owner.setup()
    native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, 160_000)
    owner.MAX_ITERATIONS = native.MAX_ITERATIONS
    // A native cell is expanded once per search stamp, and emits at most
    // eight planar neighbors plus every other layer. Each search resets n.
    const capacity = 1 + owner.layers * owner.rows * owner.cols * (owner.layers + 7)
    const arena = new NativeA01HeapArena(capacity)
    const heap = Object.getOwnPropertyDescriptor(owner, "heap")!.value as Heap
    const heapAliases = [heap.f, heap.seq, heap.id], names = Object.keys(native)
    Object.defineProperty(heap, "push", { configurable: true, value(f: number, seq: number, id: number): void {
      arena.push(f, seq, id)
    } })
    Object.defineProperty(heap, "pop", { configurable: true, value(): number {
      return arena.pop()
    } })
    deepStrictEqual(nativeFields(owner, names), nativeFields(native, names))
    while (!native.solved && !native.failed) {
      arena.begin(heap)
      try {
        for (let index = 0; index < 100; index++) { native.step(); owner.step() }
      } finally { arena.finish() }
      deepStrictEqual(nativeFields(owner, names), nativeFields(native, names))
      deepStrictEqual(owner.getOutput(), native.getOutput())
      deepStrictEqual(owner.gridStats, native.gridStats)
      checkpoints++
    }
    strictEqual(owner.iterations, seed === 5 ? 157_175 : 160_000)
    strictEqual(Object.getOwnPropertyDescriptor(owner, "heap")!.value, heap)
    strictEqual(heap.f, heapAliases[0]); strictEqual(heap.seq, heapAliases[1]); strictEqual(heap.id, heapAliases[2])
    steps += owner.iterations
    hydratedRows += arena.diagnostics.hydratedRows
    flushedRows += arena.diagnostics.flushedRows
    expect(arena.diagnostics.memoryBytes).toBeLessThan(120_000)
  }
  expect(checkpoints).toBe(9572)
  expect(steps).toBe(957_175)
  expect(hydratedRows).toBe(4_744_007)
  expect(flushedRows).toBe(1_427_773)
})
