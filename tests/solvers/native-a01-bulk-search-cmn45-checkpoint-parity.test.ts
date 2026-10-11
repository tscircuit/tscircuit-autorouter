import { deepStrictEqual, strictEqual } from "node:assert"
import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01BulkSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-bulk-search/NativeA01BulkSearchKernel"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../fixtures/parallel-grid-history-cmn45.json"

type Heap = { f: number[]; seq: number[]; id: number[]; n: number }
type State = { heap: Heap; nodePool: object[]; viaOccupantsByCell: Map<number, readonly number[]> }
function nativeFields(solver: HighDensitySolverA01, names: readonly string[]): object {
  const fields: Record<string, unknown> = {}, descriptors = Object.getOwnPropertyDescriptors(solver)
  for (let index = 0; index < names.length; index++) {
    fields[names[index]!] = descriptors[names[index]!]!.value
  }
  return fields
}

test("isolated bulk A01 preserves every native event and private checkpoint across all six critical searches", async (): Promise<void> => {
  const totals = { nativeSteps: 0, checkpoints: 0, frontierChecks: 0, nativeEventSteps: 0,
    batches: 0, consumed: 0, heapPushes: 0, heapPops: 0, expansions: 0, visitedSkips: 0,
    hydratedHeapRows: 0, hydratedLiveNodeRows: 0, hydratedRipRows: 0, createdNodeRows: 0,
    createdRipRows: 0, flushedHeapRows: 0 }
  const outcomes: object[] = []
  for (let seed = 0; seed < 6; seed++) {
    const params = { nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
      cellSizeMm: 0.1, viaDiameter: 0.3, traceThickness: 0.1,
      viaMinDistFromBorder: 0.15, traceMargin: 0.1, effort: 1,
      hyperParameters: { shuffleSeed: seed } }
    const native = new HighDensitySolverA01(structuredClone(params))
    const owner = new HighDensitySolverA01(structuredClone(params))
    native.setup(); owner.setup()
    native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, 160_000)
    owner.MAX_ITERATIONS = native.MAX_ITERATIONS
    const kernel = new NativeA01BulkSearchKernel(owner), host = owner as unknown as State
    const heap = host.heap, arrays = [heap.f, heap.seq, heap.id], pool = host.nodePool
    const names = Object.keys(native)
    deepStrictEqual(nativeFields(owner, names), nativeFields(native, names))
    while (!native.solved && !native.failed) {
      let offset = 0
      while (offset < 100) {
        const oldPool = host.nodePool, oldNodes = host.nodePool.slice(), oldCache = [...host.viaOccupantsByCell]
        const result = kernel.runActiveSearch(owner, 100 - offset)
        for (let index = 0; index < result.consumed; index++) native.step()
        offset += result.consumed
        strictEqual(host.heap, heap); strictEqual(host.nodePool, oldPool)
        for (let index = 0; index < arrays.length; index++) strictEqual([heap.f,heap.seq,heap.id][index], arrays[index])
        for (let index = 0; index < oldNodes.length; index++) strictEqual(host.nodePool[index], oldNodes[index])
        for (let index = 0; index < oldCache.length; index++) strictEqual(host.viaOccupantsByCell.get(oldCache[index]![0]),oldCache[index]![1])
        deepStrictEqual(nativeFields(owner, names), nativeFields(native, names))
        totals.frontierChecks++
        if (offset < 100 && result.event !== "limit") {
          native.step(); owner.step(); offset++; totals.nativeEventSteps++
          deepStrictEqual(nativeFields(owner, names), nativeFields(native, names))
        }
      }
      deepStrictEqual(owner.getOutput(), native.getOutput())
      deepStrictEqual(owner.gridStats, native.gridStats)
      totals.checkpoints++
    }
    strictEqual(owner.iterations, seed === 5 ? 157_175 : 160_000)
    totals.nativeSteps += owner.iterations
    for (const key of Object.keys(kernel.diagnostics) as (keyof typeof kernel.diagnostics)[]) {
      if (key !== "memoryBytes") totals[key] += kernel.diagnostics[key]
    }
    outcomes.push({ seed, iterations: owner.iterations, solved: owner.solved, failed: owner.failed,
      error: owner.error, diagnostics: kernel.diagnostics })
    expect(kernel.diagnostics.memoryBytes).toBeLessThan(64*1024*1024)
  }
  expect(totals.nativeSteps).toBe(957_175)
  expect(totals.checkpoints).toBe(9572)
  expect(totals.consumed).toBeGreaterThan(950_000)
  expect(totals.heapPops).toBe(totals.consumed)
  expect(totals.batches).toBeLessThan(12_000)
  if (process.env.BULK_A01_PROOF_PATH) await Bun.write(process.env.BULK_A01_PROOF_PATH,
    JSON.stringify({ kind: "functional-state-and-operation-proof", noTimingComparison: true, totals, outcomes },null,2))
})
