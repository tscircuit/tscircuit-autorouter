import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01HeapArena, type NativeA01HeapColumns } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-heap-arena/NativeA01HeapArena"

type Heap = NativeA01HeapColumns & { push(f: number, seq: number, id: number): void; pop(): number; clear(): void }
function createNativeHeap(): Heap {
  const solver = new HighDensitySolverA01({ nodeWithPortPoints: {
    capacityMeshNodeId: "arena_oracle", center: { x: 0, y: 0 }, width: 0.1, height: 0.1,
    availableZ: [0], portPoints: [],
  }, cellSizeMm: 0.1, viaDiameter: 0.3 })
  solver.setup()
  return Object.getOwnPropertyDescriptor(solver, "heap")!.value as Heap
}

function assertColumns(native: Heap, host: Heap): void {
  expect(host.n).toBe(native.n)
  for (const column of ["f", "seq", "id"] as const) {
    expect(host[column].length).toBe(native[column].length)
    for (let index = 0; index < native[column].length; index++) {
      expect(Object.is(host[column][index], native[column][index])).toBe(true)
    }
  }
}

test("isolated f64 heap arena reproduces native ties/NaN/signedzero and all stale rows across mutated observer boundaries", (): void => {
  const native = createNativeHeap(), host = createNativeHeap(), arena = new NativeA01HeapArena(4096)
  const aliases = [host.f, host.seq, host.id]
  let randomState = 0x91fabbcd
  const random = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    const value = randomState / 0x100000000
    return value
  }
  const values = [Number.NaN, -Infinity, Infinity, -0, 0, -1, 1, 1, 0.1, -0.1, Number.MAX_VALUE, Number.MIN_VALUE]
  let totalPops = 0, interrupted = false
  for (let batch = 0; batch < 1000; batch++) {
    // Same-reference numeric mutations to both active and stale tails must be
    // observed at each new boundary, without trusting persistent mirror data.
    if (batch % 17 === 0 && native.f.length) {
      const row = Math.floor(random() * native.f.length), value = values[batch % values.length]!
      native.f[row] = host.f[row] = value
      native.seq[row] = host.seq[row] = values[(batch + 3) % values.length]!
    }
    arena.begin(host)
    try {
      for (let operation = 0; operation < 100; operation++) {
        if (native.n > 2000 || native.n > 0 && random() < 0.48) {
          const expected = native.pop(), actual = arena.pop()
          expect(Object.is(actual, expected)).toBe(true)
          totalPops++
        } else {
          const f = random() < 0.25 ? values[Math.floor(random() * values.length)]! : random() * 8 - 4
          const seq = random() < 0.2 ? values[Math.floor(random() * values.length)]! : batch * 100 + operation
          const id = batch * 100 + operation
          native.push(f, seq, id)
          arena.push(f, seq, id)
        }
        expect(host.n).toBe(native.n)
        if (batch % 113 === 0 && operation === 49) {
          native.clear()
          host.clear()
        }
        if (batch === 541 && operation === 61) { interrupted = true; throw new Error("native quantum interruption") }
      }
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.message !== "native quantum interruption") throw error
    } finally { arena.finish() }
    assertColumns(native, host)
    expect(host.f).toBe(aliases[0]); expect(host.seq).toBe(aliases[1]); expect(host.id).toBe(aliases[2])
  }
  expect(interrupted).toBe(true)
  expect(totalPops).toBeGreaterThan(40_000)
  expect(arena.diagnostics.batches).toBe(1000)
  expect(arena.diagnostics.flushedRows).toBeLessThan(100_000 * 8)
  expect(arena.diagnostics.memoryBytes).toBeLessThan(140_000)
})
