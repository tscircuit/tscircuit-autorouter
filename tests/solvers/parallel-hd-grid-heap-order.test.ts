import { expect, test } from "bun:test"
import { PackedHighDensityCandidateHeap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedHighDensityCandidateHeap"
import { type Node, SingleRouteCandidatePriorityQueue } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

test("packed HD heap preserves native equal-priority order and immutable candidate identity", (): void => {
  const native = new SingleRouteCandidatePriorityQueue<Node>([])
  const packed = new PackedHighDensityCandidateHeap([])
  const makeNode = (index: number): Node => ({
    x: index, y: -index, z: index % 4, g: index / 13, h: 0,
    f: index % 97 === 0 ? Number.NaN : index % 79 === 0 ? Infinity : index % 71 === 0 ? -Infinity : index % 11,
    parent: null,
  })
  for (let index = 0; index < 1_027; index++) {
    const node = makeNode(index)
    native.enqueue(node)
    packed.enqueue(node)
  }
  let popped = 0
  while (native.peek()) {
    expect(packed.peek()).toBe(native.peek())
    expect(packed.getTopN(19)).toEqual(native.getTopN(19))
    expect(packed.dequeue()).toBe(native.dequeue())
    if (popped < 100 && popped % 3 === 0) {
      const node = makeNode(2_000 + popped)
      native.enqueue(node)
      packed.enqueue(node)
    }
    popped++
  }
  expect(popped).toBe(1_061)
  expect(packed.peek()).toBeNull()
  expect(packed.dequeue()).toBeNull()
  expect(packed.getTopN(10)).toEqual([])
})
