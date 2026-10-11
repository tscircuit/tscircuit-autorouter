import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import { FrozenA01MinHeap } from "tests/fixtures/FrozenA01MinHeap"

type HeapState = { f: number[]; seq: number[]; id: number[]; n: number }
type HeapApi = {
  push(f: number, seq: number, id: number): void
  pop(): number
  clear(): void
  readonly size: number
}

class FrozenHeapA01Solver extends HighDensitySolverA01 {
  override _setup(): void {
    super._setup()
    ;(this as unknown as { heap: HeapApi }).heap = new FrozenA01MinHeap()
  }
}

test("hole sifts preserve A01 heap storage, malformed priorities, routes, and iteration counts", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "heap-parity",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 2],
      portPoints: [],
    },
    cellSizeMm: 0.1,
    viaDiameter: 0.2,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaMinDistFromBorder: 0.1,
  }
  const solver = new HighDensitySolverA01(params)
  solver.setup()
  const HeapConstructor = (solver as unknown as { heap: HeapApi }).heap.constructor as new () => HeapApi
  const heap = new HeapConstructor()
  const original = new FrozenA01MinHeap()
  let seed = 4817
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const special = [NaN, Infinity, -Infinity, 0, -0, Number.MIN_VALUE, Number.MAX_VALUE]
  for (let operation = 0; operation < 2500; operation++) {
    if (operation % 137 === 0) {
      heap.clear()
      original.clear()
    } else if (heap.size > 0 && random() < 0.45) {
      expect(Object.is(heap.pop(), original.pop())).toBe(true)
    } else {
      const f = operation % 3 === 0 ? special[operation % special.length]! : Math.floor(random() * 11) - 5
      const seq = operation % 19 === 0 ? special[operation % special.length]! : operation % 7
      const id = operation % 23 === 0 ? special[operation % special.length]! : operation % 17
      heap.push(f, seq, id)
      original.push(f, seq, id)
    }
    expect(heap.size).toBe(original.size)
    // Compare retained inactive slots as well as the active heap, rather than
    // accepting only an equivalent dequeue order.
    const actual = heap as unknown as HeapState
    const expected = original as unknown as HeapState
    expect({ f: actual.f, seq: actual.seq, id: actual.id, n: actual.n }).toEqual({
      f: expected.f, seq: expected.seq, id: expected.id, n: expected.n,
    })
  }
  while (heap.size > 0) expect(Object.is(heap.pop(), original.pop())).toBe(true)

  const cases = [
    [
      { connectionName: "a", x: -1, y: 0, z: 0 },
      { connectionName: "a", x: 1, y: 0, z: 0 },
    ],
    [
      { connectionName: "a", x: -1, y: -0.6, z: 0 },
      { connectionName: "a", x: 1, y: 0.6, z: 0 },
      { connectionName: "b", x: -1, y: 0.6, z: 0 },
      { connectionName: "b", x: 1, y: -0.6, z: 0 },
    ],
    [
      { connectionName: "a", x: -1, y: -0.5, z: 0 },
      { connectionName: "a", x: 1, y: -0.5, z: 2 },
      { connectionName: "b", x: -1, y: 0.5, z: 2 },
      { connectionName: "b", x: 1, y: 0.5, z: 0 },
    ],
  ]
  for (const portPoints of cases) {
    const node = { ...params.nodeWithPortPoints, portPoints }
    const optimized = new HighDensitySolverA01({ ...params, nodeWithPortPoints: node })
    const reference = new FrozenHeapA01Solver({ ...params, nodeWithPortPoints: node })
    for (let iteration = 0; iteration < 10_000 && !optimized.solved && !optimized.failed; iteration++) {
      optimized.step()
      reference.step()
    }
    expect(optimized.solved).toBe(true)
    expect(reference.solved).toBe(true)
    expect(optimized.failed).toBe(reference.failed)
    expect(optimized.iterations).toBe(reference.iterations)
    expect(optimized.getOutput()).toEqual(reference.getOutput())
  }
})
