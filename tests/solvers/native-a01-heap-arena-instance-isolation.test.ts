import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01HeapArena, type NativeA01HeapColumns } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-heap-arena/NativeA01HeapArena"

type Heap = NativeA01HeapColumns & { push(f: number, seq: number, id: number): void; pop(): number }
function createHeap(): Heap {
  const solver = new HighDensitySolverA01({ nodeWithPortPoints: {
    capacityMeshNodeId: "arena_instance", center: { x: 0, y: 0 },
    width: 0.1, height: 0.1, availableZ: [0], portPoints: [],
  }, cellSizeMm: 0.1, viaDiameter: 0.3 })
  solver.setup()
  return Object.getOwnPropertyDescriptor(solver, "heap")!.value as Heap
}

test("configured C heap pointers remain instance-local across interleaved arenas and repeated native boundaries", (): void => {
  const arenas = [new NativeA01HeapArena(64), new NativeA01HeapArena(256)]
  const native = [createHeap(), createHeap()], hosts = [createHeap(), createHeap()]
  const values = [NaN, -0, 0, Infinity, -Infinity, 0.1, 0.1, -0.1]
  for (let batch = 0; batch < 25; batch++) {
    for (let index = 0; index < 2; index++) arenas[index]!.begin(hosts[index]!)
    for (let operation = 0; operation < 50; operation++) {
      for (let index = 0; index < 2; index++) {
        const heap = native[index]!, arena = arenas[index]!
        if (heap.n < 2 || operation % 3 !== 0) {
          const f = values[(batch + operation + index) % values.length]!
          const seq = (operation * 3 + index) % 11, id = batch * 1000 + operation * 2 + index
          heap.push(f, seq, id)
          arena.push(f, seq, id)
        } else expect(Object.is(arena.pop(), heap.pop())).toBe(true)
      }
    }
    for (let index = 0; index < 2; index++) {
      arenas[index]!.finish()
      expect(hosts[index]!.n).toBe(native[index]!.n)
      for (const column of ["f", "seq", "id"] as const) {
        expect(hosts[index]![column].length).toBe(native[index]![column].length)
        for (let row = 0; row < native[index]![column].length; row++) {
          expect(Object.is(hosts[index]![column][row], native[index]![column][row])).toBe(true)
        }
      }
    }
    // Preserve independent live native tails while keeping both capacities bounded.
    for (let index = 0; index < 2; index++) { native[index]!.n = 0; hosts[index]!.n = 0 }
  }
})
