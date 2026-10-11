import { expect, test } from "bun:test"
import { defaultB01Params, HighDensitySolverB01 } from "@tscircuit/high-density-b01"

// Independent frozen swap-based heap from the pinned dependency.
const frozenHeapSource = String.raw`
class TypedMinHeap {
  private f = new Float64Array(1024)
  private seq = new Uint32Array(1024)
  private id = new Int32Array(1024)
  private n = 0

  push(f: number, seq: number, id: number) {
    this.ensureCapacity(this.n + 1)
    let i = this.n++
    this.f[i] = f
    this.seq[i] = seq
    this.id[i] = id
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.less(p, i)) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const out = this.id[0]!
    this.n--
    if (this.n > 0) {
      this.f[0] = this.f[this.n]!
      this.seq[0] = this.seq[this.n]!
      this.id[0] = this.id[this.n]!
      this.siftDown(0)
    }
    return out
  }

  get size() {
    return this.n
  }

  clear() {
    this.n = 0
  }

  private ensureCapacity(size: number) {
    if (size <= this.f.length) return
    let next = this.f.length
    while (next < size) next *= 2

    const nf = new Float64Array(next)
    nf.set(this.f)
    this.f = nf

    const ns = new Uint32Array(next)
    ns.set(this.seq)
    this.seq = ns

    const ni = new Int32Array(next)
    ni.set(this.id)
    this.id = ni
  }

  private siftDown(i: number) {
    while (true) {
      const l = i * 2 + 1
      const r = l + 1
      if (l >= this.n) return
      let m = l
      if (r < this.n && !this.less(l, r)) m = r
      if (this.less(i, m)) return
      this.swap(i, m)
      i = m
    }
  }

  private less(i: number, j: number) {
    const fi = this.f[i]!
    const fj = this.f[j]!
    if (fi !== fj) return fi < fj
    return this.seq[i]! < this.seq[j]!
  }

  private swap(i: number, j: number) {
    const tf = this.f[i]!
    this.f[i] = this.f[j]!
    this.f[j] = tf

    const ts = this.seq[i]!
    this.seq[i] = this.seq[j]!
    this.seq[j] = ts

    const ti = this.id[i]!
    this.id[i] = this.id[j]!
    this.id[j] = ti
  }
}
`
const FrozenHeap = new Function(
  new Bun.Transpiler({ loader: "ts" }).transformSync(frozenHeapSource) +
    "\nreturn TypedMinHeap;",
)()

type HeapState = {
  f: Float64Array
  seq: Uint32Array
  id: Int32Array
  n: number
  readonly size: number
  push: (f: number, seq: number, id: number) => void
  pop: () => number
  clear: () => void
}

test("B01 heap preserves exact typed buffers and coercion", () => {
  const solver = new HighDensitySolverB01({
    ...defaultB01Params,
    highResolutionCellSize: 0.25,
    lowResolutionCellSize: 0.5,
    highResolutionCellThickness: 1,
    obstacles: [],
    nodeWithPortPoints: {
      capacityMeshNodeId: "b01-heap-buffer-parity",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "net", x: -0.5, y: 0, z: 0 },
        { connectionName: "net", x: 0.5, y: 0, z: 0 },
      ],
    },
  })
  solver.step()
  expect(solver.failed).toBe(false)
  const Heap = (solver as unknown as { heap: HeapState }).heap
    .constructor as new () => HeapState
  const current = new Heap()
  const original = new FrozenHeap() as HeapState
  const compare = (): void => {
    expect(current.size).toBe(original.size)
    expect(current.n).toBe(original.n)
    for (const field of ["f", "seq", "id"] as const) {
      // Compare unused capacity and IEEE payload bits as well as active slots.
      expect(
        Buffer.from(current[field].buffer).equals(
          new Uint8Array(original[field].buffer),
        ),
      ).toBe(true)
    }
  }
  const push = (f: number, seq: number, id: number): void => {
    original.push(f, seq, id)
    current.push(f, seq, id)
    compare()
  }
  const pop = (): void => {
    expect(current.pop()).toBe(original.pop())
    compare()
  }
  const clear = (): void => {
    original.clear()
    current.clear()
    compare()
  }
  compare()
  // Descending priorities force every parent move across two capacity growths.
  for (let index = 0; index < 2300; index++) {
    push(2300 - index, index, index)
  }
  expect(current.f.length).toBe(4096)
  for (let index = 0; index < 700; index++) pop()
  let seed = 98174
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed >>> 8
  }
  for (let index = 0; index < 700; index++) {
    if (random() % 4 === 0) pop()
    else push(random() % 17, random() % 11, random() | 0)
  }
  clear()
  const payloadNaN = new Float64Array(
    new BigUint64Array([0x7ff8000000000173n]).buffer,
  )[0]!
  const priorities = [NaN, payloadNaN, Infinity, -Infinity, -0, 0, 1, 1, -1]
  const sequences = [
    -1,
    0,
    1,
    0xffffffff,
    0x100000000,
    0x100000001,
    1.5,
    NaN,
    Infinity,
  ]
  const ids = [
    -0x80000001,
    -0x80000000,
    -1,
    0,
    0x7fffffff,
    0x80000000,
    0x100000001,
    NaN,
    Infinity,
  ]
  for (let index = 0; index < 180; index++) {
    push(
      priorities[index % priorities.length]!,
      sequences[index % sequences.length]!,
      ids[index % ids.length]!,
    )
  }
  while (original.size > 0) pop()
  // Clear preserves inactive buffer contents; the next search reuses capacity.
  clear()
  for (let index = 0; index < 40; index++) push(3, 7, index)
  while (original.size > 0) pop()
  clear()
  // Retain the original empty-pop behavior as well.
  pop()
  push(1, 2, 3)
  compare()
})
