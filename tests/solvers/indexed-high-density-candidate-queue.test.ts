import { expect, test } from "bun:test"
import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteCandidateQueue } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteCandidateQueue"

type Candidate = Node & { label: string; key: number }
type Queue = {
  dequeue(): Node | null
  peek(): Node | null
  enqueue(node: Node): void
  getTopN(count: number): Node[]
}

// Frozen unkeyed heap from 7412fb8. Keep the comparisons and tie behavior
// independent of changes to either production queue.
class OriginalQueue implements Queue {
  private heap: Node[] = []

  constructor(nodes: Node[]) {
    this.heap = []
    for (const node of nodes) {
      this.enqueue(node)
    }
  }

  dequeue(): Node | null {
    if (this.heap.length === 0) {
      return null
    }
    const item = this.heap[0]!
    this.heap[0] = this.heap[this.heap.length - 1]!
    this.heap.pop()
    this.heapifyDown()
    return item
  }

  peek(): Node | null {
    if (this.heap.length === 0) {
      return null
    }
    return this.heap[0]!
  }

  enqueue(item: Node): void {
    this.heap.push(item)
    this.heapifyUp()
  }

  heapifyUp(): void {
    let index = this.heap.length - 1
    const item = this.heap[index]!
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.heap[parentIndex]!
      if (parent.f <= item.f) break
      this.heap[index] = parent
      index = parentIndex
    }
    this.heap[index] = item
  }

  heapifyDown(): void {
    let index = 0
    const heapLength = this.heap.length
    const item = this.heap[index]
    if (!item) return
    while (true) {
      const leftChildIndex = 2 * index + 1
      if (leftChildIndex >= heapLength) break
      const rightChildIndex = leftChildIndex + 1
      let smallerChildIndex = leftChildIndex
      if (
        rightChildIndex < heapLength &&
        this.heap[rightChildIndex]!.f < this.heap[leftChildIndex]!.f
      ) {
        smallerChildIndex = rightChildIndex
      }
      if (item.f < this.heap[smallerChildIndex]!.f) {
        break
      }
      this.heap[index] = this.heap[smallerChildIndex]!
      index = smallerChildIndex
    }
    this.heap[index] = item
  }

  getTopN(count: number): Node[] {
    return [...this.heap].sort((left, right) => left.f - right.f).slice(0, count)
  }
}

function createCandidate(key: number, f: number, label: string): Candidate {
  return {
    key,
    f,
    label,
    x: key,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    parent: null,
  }
}

function drain(queue: Queue): Node[] {
  const nodes: Node[] = []
  for (let node = queue.dequeue(); node !== null; node = queue.dequeue()) {
    nodes.push(node)
  }
  expect(queue.dequeue()).toBeNull()
  return nodes
}

function expectSameNodes(actual: Node[], expected: Node[]): void {
  expect(actual.length).toBe(expected.length)
  for (let index = 0; index < expected.length; index++) {
    expect(actual[index]).toBe(expected[index])
    expect(Object.is(actual[index]!.f, expected[index]!.f)).toBe(true)
    expect(actual[index]!.parent).toBe(expected[index]!.parent)
  }
}

test("indexed HD frontier drops strict dominance while preserving heap ties and public mutation", (): void => {
  const getKey = (node: Node): number => (node as Candidate).key
  const frontier = new SingleHighDensityRouteCandidateQueue([], getKey)
  const candidates = [
    createCandidate(1, 10, "first"),
    createCandidate(2, 4, "other"),
    createCandidate(1, 12, "worse"),
    createCandidate(1, 3, "better"),
    createCandidate(1, 3, "equal-1"),
    createCandidate(1, 3, "equal-2"),
    createCandidate(2, 5, "other-worse"),
    createCandidate(2, 2, "other-better"),
  ]
  for (const candidate of candidates) {
    frontier.enqueueKeyed(candidate)
  }
  expect(frontier.diagnostics).toEqual({
    keyedEnqueues: 8,
    inserted: 4,
    replaced: 2,
    dominated: 2,
    equalPriorityRetained: 2,
    dequeued: 0,
    maximumSize: 4,
  })
  expectSameNodes(drain(frontier), [
    candidates[7]!,
    candidates[3]!,
    candidates[5]!,
    candidates[4]!,
  ])
  expect(frontier.diagnostics.dequeued).toBe(4)

  const ties = Array.from({ length: 4 }, (_, index): Candidate =>
    createCandidate(1, 1, `tie-${index}`),
  )
  const tied = new SingleHighDensityRouteCandidateQueue([], getKey)
  for (const candidate of ties) {
    tied.enqueueKeyed(candidate)
  }
  expectSameNodes(drain(tied), [ties[0]!, ties[1]!, ties[3]!, ties[2]!])
  expect(tied.diagnostics.equalPriorityRetained).toBe(3)

  const zeroes = new SingleHighDensityRouteCandidateQueue([], getKey)
  const zeroOracle = new OriginalQueue([])
  for (const [key, f] of [[-0, -0], [0, 0], [-0, -0]]) {
    const candidate = createCandidate(key!, f!, "signed-zero")
    zeroes.enqueueKeyed(candidate)
    zeroOracle.enqueue(candidate)
  }
  expectSameNodes(drain(zeroes), drain(zeroOracle))
  expect(zeroes.diagnostics.equalPriorityRetained).toBe(2)

  // All constructor entries remain unkeyed, including duplicates. The
  // oracle also checks incomparable priorities and both signed zeroes.
  const priorities = [NaN, Infinity, -Infinity, -0, 0, 2, 2, -3, 7]
  const initial = priorities.map((priority, index): Candidate =>
    createCandidate(0, priority, `initial-${index}`),
  )
  const mixed = new SingleHighDensityRouteCandidateQueue(initial, getKey)
  const mixedOracle = new OriginalQueue(initial)
  let seed = 19
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let index = 0; index < 180; index++) {
    const key = index % 9 === 0 ? index + 0.5 : index + 100
    const priority = priorities[Math.floor(random() * priorities.length)]!
    const candidate = createCandidate(key, priority, `mixed-${index}`)
    mixed.enqueueKeyed(candidate)
    mixedOracle.enqueue(candidate)
    if (index % 7 === 0) {
      expect(mixed.dequeue()).toBe(mixedOracle.dequeue())
    }
  }
  expectSameNodes(drain(mixed), drain(mixedOracle))

  const invalidKeys = [NaN, Infinity, -Infinity, 0.5, 2 ** 53]
  for (const key of invalidKeys) {
    const indexed = new SingleHighDensityRouteCandidateQueue([], getKey)
    const oracle = new OriginalQueue([])
    for (const f of [5, 2, 8, 2]) {
      const candidate = createCandidate(key, f, `invalid-${f}`)
      indexed.enqueueKeyed(candidate)
      oracle.enqueue(candidate)
    }
    expectSameNodes(drain(indexed), drain(oracle))
    expect(indexed.diagnostics.dominated).toBe(0)
    expect(indexed.diagnostics.replaced).toBe(0)
  }

  const finite = new SingleHighDensityRouteCandidateQueue([], getKey)
  const best: Candidate[] = []
  for (let key = 63; key >= 0; key--) {
    finite.enqueueKeyed(createCandidate(key, key * 100 + 30, `old-${key}`))
  }
  for (let index = 0; index < 64; index++) {
    const key = (index * 37) % 64
    const better = createCandidate(key, key * 100 + 10, `best-${key}`)
    best.push(better)
    finite.enqueueKeyed(better)
    finite.enqueueKeyed(createCandidate(key, key * 100 + 20, `worse-${key}`))
  }
  best.sort((left, right): number => left.f - right.f)
  expectSameNodes(drain(finite), best)
  expect(finite.diagnostics.inserted).toBe(64)
  expect(finite.diagnostics.replaced).toBe(64)
  expect(finite.diagnostics.dominated).toBe(64)
  expect(finite.diagnostics.maximumSize).toBe(64)
  // A dequeued key can be queued again; its old heap slot must not survive.
  const requeued = createCandidate(0, 100, "requeued")
  finite.enqueueKeyed(requeued)
  expect(finite.dequeue()).toBe(requeued)

  const interleaved = new SingleHighDensityRouteCandidateQueue([], getKey)
  const pending = new Map<number, Candidate>()
  for (let key = 0; key < 16; key++) {
    const candidate = createCandidate(key, key + 10, `pending-${key}`)
    pending.set(key, candidate)
    interleaved.enqueueKeyed(candidate)
  }
  for (let round = 0; round < 20; round++) {
    const expected = [...pending.values()].sort(
      (left, right): number => left.f - right.f,
    )[0]!
    expect(interleaved.dequeue()).toBe(expected)
    pending.delete(expected.key)
    const next = createCandidate(expected.key, 100 + round, `next-${round}`)
    pending.set(next.key, next)
    interleaved.enqueueKeyed(next)
    const key = (round * 7) % 16
    const better = createCandidate(key, -1000 - round, `improved-${round}`)
    pending.set(key, better)
    interleaved.enqueueKeyed(better)
    interleaved.enqueueKeyed(createCandidate(key, better.f + 0.1, "dominated"))
  }
  expectSameNodes(
    drain(interleaved),
    [...pending.values()].sort((left, right): number => left.f - right.f),
  )
  expect(interleaved.diagnostics.inserted).toBe(36)
  expect(interleaved.diagnostics.replaced).toBe(20)
  expect(interleaved.diagnostics.dominated).toBe(20)

  const live = createCandidate(1, 10, "live")
  const liveQueue = new SingleHighDensityRouteCandidateQueue([], getKey)
  const liveOracle = new OriginalQueue([])
  liveQueue.enqueueKeyed(live)
  liveOracle.enqueue(live)
  live.f = 1
  const nowWorse = createCandidate(1, 5, "now-worse")
  liveQueue.enqueueKeyed(nowWorse)
  liveOracle.enqueue(nowWorse)
  expect(liveQueue.diagnostics.dominated).toBe(0)
  live.key = 9
  const changedKey = createCandidate(1, 2, "changed-key")
  liveQueue.enqueueKeyed(changedKey)
  liveOracle.enqueue(changedKey)
  expectSameNodes(drain(liveQueue), drain(liveOracle))
  const changedPriority = createCandidate(1, 4, "changed-priority")
  const child = createCandidate(2, 8, "child")
  const changed = new SingleHighDensityRouteCandidateQueue([], getKey)
  const changedOracle = new OriginalQueue([])
  for (const candidate of [changedPriority, child]) {
    changed.enqueueKeyed(candidate)
    changedOracle.enqueue(candidate)
  }
  changedPriority.f = 100
  const improvedCurrent = createCandidate(1, 50, "improved-current")
  changed.enqueueKeyed(improvedCurrent)
  changedOracle.enqueue(improvedCurrent)
  expectSameNodes(drain(changed), drain(changedOracle))
  const incomparable = createCandidate(1, 5, "incomparable")
  const nonfinite = new SingleHighDensityRouteCandidateQueue([], getKey)
  const nonfiniteOracle = new OriginalQueue([])
  nonfinite.enqueueKeyed(incomparable)
  nonfiniteOracle.enqueue(incomparable)
  incomparable.f = NaN
  const replacement = createCandidate(1, 3, "finite-after-nan")
  nonfinite.enqueueKeyed(replacement)
  nonfiniteOracle.enqueue(replacement)
  expectSameNodes(drain(nonfinite), drain(nonfiniteOracle))

  for (const exposure of ["enqueue", "peek", "getTopN"] as const) {
    const first = createCandidate(1, 1, `${exposure}-first`)
    const second = createCandidate(2, 2, `${exposure}-second`)
    const indexed = new SingleHighDensityRouteCandidateQueue([first, second], getKey)
    const oracle = new OriginalQueue([first, second])
    if (exposure === "enqueue") {
      const external = createCandidate(1, 4, "external")
      indexed.enqueue(external)
      oracle.enqueue(external)
    } else if (exposure === "peek") {
      expect(indexed.peek()).toBe(oracle.peek())
    } else {
      expectSameNodes(indexed.getTopN(8), oracle.getTopN(8))
    }
    first.f = 50
    second.f = -0
    second.key = 1
    for (const f of [5, -1, 10, NaN, Infinity, -Infinity, 0]) {
      const candidate = createCandidate(1, f, `${exposure}-${f}`)
      indexed.enqueueKeyed(candidate)
      oracle.enqueue(candidate)
    }
    expectSameNodes(drain(indexed), drain(oracle))
    expect(indexed.diagnostics.dominated).toBe(0)
    expect(indexed.diagnostics.replaced).toBe(0)
    const next = createCandidate(1, 2, "after-empty")
    const worse = createCandidate(1, 3, "after-empty-worse")
    indexed.enqueueKeyed(next)
    indexed.enqueueKeyed(worse)
    expectSameNodes(drain(indexed), [next, worse])
  }

  class CustomIndexedQueue extends SingleHighDensityRouteCandidateQueue {
    upCalls = 0
    downCalls = 0

    override heapifyUp(): void {
      this.upCalls++
      super.heapifyUp()
    }

    override heapifyDown(): void {
      this.downCalls++
      super.heapifyDown()
    }
  }
  class CustomOriginalQueue extends OriginalQueue {
    upCalls = 0
    downCalls = 0

    override heapifyUp(): void {
      this.upCalls++
      super.heapifyUp()
    }

    override heapifyDown(): void {
      this.downCalls++
      super.heapifyDown()
    }
  }
  const custom = new CustomIndexedQueue([], getKey)
  const customOracle = new CustomOriginalQueue([])
  for (const f of [5, 2, 8, 2, NaN, Infinity]) {
    const candidate = createCandidate(1, f, `custom-${f}`)
    custom.enqueueKeyed(candidate)
    customOracle.enqueue(candidate)
  }
  expectSameNodes(drain(custom), drain(customOracle))
  expect(custom.upCalls).toBe(customOracle.upCalls)
  expect(custom.downCalls).toBe(customOracle.downCalls)
  expect(custom.diagnostics.replaced).toBe(0)
  expect(custom.diagnostics.dominated).toBe(0)

  const nativeUp = SingleHighDensityRouteCandidateQueue.prototype.heapifyUp
  for (const overrideTarget of ["instance", "prototype"] as const) {
    const indexed = new SingleHighDensityRouteCandidateQueue([], getKey)
    const oracle = new OriginalQueue([])
    const first = createCandidate(1, 5, "before-override")
    indexed.enqueueKeyed(first)
    oracle.enqueue(first)
    let upCalls = 0
    const overriddenUp = function (this: SingleHighDensityRouteCandidateQueue): void {
      upCalls++
      nativeUp.call(this)
    }
    try {
      if (overrideTarget === "instance") {
        indexed.heapifyUp = overriddenUp
      } else {
        SingleHighDensityRouteCandidateQueue.prototype.heapifyUp = overriddenUp
      }
      for (const f of [2, 8, 2]) {
        const candidate = createCandidate(1, f, `${overrideTarget}-${f}`)
        indexed.enqueueKeyed(candidate)
        oracle.enqueue(candidate)
      }
      expectSameNodes(drain(indexed), drain(oracle))
      expect(upCalls).toBe(3)
      expect(indexed.diagnostics.replaced).toBe(0)
      expect(indexed.diagnostics.dominated).toBe(0)
    } finally {
      SingleHighDensityRouteCandidateQueue.prototype.heapifyUp = nativeUp
    }
  }

  const bypassed = new SingleHighDensityRouteCandidateQueue([], getKey)
  const bypassOracle = new OriginalQueue([])
  const beforeBypass = createCandidate(1, 5, "before-prototype-bypass")
  bypassed.enqueueKeyed(beforeBypass)
  bypassOracle.enqueue(beforeBypass)
  const explicit = createCandidate(1, 2, "prototype-enqueue")
  SingleRouteCandidatePriorityQueue.prototype.enqueue.call(bypassed, explicit)
  bypassOracle.enqueue(explicit)
  for (const f of [8, 1, 2, Number.NaN]) {
    const candidate = createCandidate(1, f, `after-prototype-bypass-${f}`)
    bypassed.enqueueKeyed(candidate)
    bypassOracle.enqueue(candidate)
  }
  expectSameNodes(drain(bypassed), drain(bypassOracle))
  expect(bypassed.diagnostics.dominated).toBe(0)
  expect(bypassed.diagnostics.replaced).toBe(0)
})
