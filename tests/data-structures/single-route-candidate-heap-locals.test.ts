import { expect, test } from "bun:test"
import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"

type IdentifiedNode = Node & { id: number }

class OriginalHeapQueue extends SingleRouteCandidatePriorityQueue<IdentifiedNode> {
  override heapifyDown(): void {
    const state = this as unknown as { heap: IdentifiedNode[] }
    let index = 0
    const heapLength = state.heap.length
    const item = state.heap[index]
    if (!item) return
    while (true) {
      const leftChildIndex = 2 * index + 1
      if (leftChildIndex >= heapLength) break
      const rightChildIndex = leftChildIndex + 1
      let smallerChildIndex = leftChildIndex
      if (
        rightChildIndex < heapLength &&
        state.heap[rightChildIndex].f < state.heap[leftChildIndex].f
      ) {
        smallerChildIndex = rightChildIndex
      }
      if (item.f < state.heap[smallerChildIndex].f) break
      state.heap[index] = state.heap[smallerChildIndex]
      index = smallerChildIndex
    }
    state.heap[index] = item
  }
}

test("heap locals preserve exact operations with ties and mutable priorities", () => {
  let seed = 217395
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = seed / 0x100000000
    return value
  }
  const queue = new SingleRouteCandidatePriorityQueue<IdentifiedNode>([])
  const original = new OriginalHeapQueue([])
  const queueState = queue as unknown as { heap: IdentifiedNode[] }
  const originalState = original as unknown as { heap: IdentifiedNode[] }
  const priorities = [NaN, -Infinity, Infinity, -0, 0, 1, 2, 2, 4]
  let id = 0
  for (let step = 0; step < 5000; step++) {
    const operation = random()
    const priority =
      step % 3 === 0
        ? priorities[step % priorities.length]
        : Math.floor(random() * 64)
    if (step % 37 === 0 && queueState.heap.length > 0) {
      const changedIndex = Math.floor(random() * queueState.heap.length)
      queueState.heap[changedIndex].f = priority
    }
    if (operation < 0.5) {
      const node: IdentifiedNode = {
        id: id++,
        x: 0,
        y: 0,
        z: 0,
        g: 0,
        h: 0,
        f: priority,
        parent: null,
      }
      queue.enqueue(node)
      original.enqueue(node)
    } else if (operation < 0.8) {
      expect(queue.dequeue()).toBe(original.dequeue())
    } else if (operation < 0.9) {
      // The same node is stored in both queues. Public priority changes must
      // be observed by the next operation, including direct heap repairs.
      if (queueState.heap.length > 0) queueState.heap[0].f = priority
      queue.heapifyDown()
      original.heapifyDown()
    } else {
      const last = queueState.heap.length - 1
      if (last >= 0) queueState.heap[last].f = priority
      queue.heapifyUp()
      original.heapifyUp()
    }
    expect(queue.peek()).toBe(original.peek())
    expect(queueState.heap.map(({ id }) => id)).toEqual(
      originalState.heap.map(({ id }) => id),
    )
    if (step % 17 === 0) {
      expect(queue.getTopN(12)).toEqual(original.getTopN(12))
    }
  }
  while (original.peek()) {
    expect(queue.dequeue()).toBe(original.dequeue())
  }
  queue.heapifyDown()
  original.heapifyDown()
  queue.heapifyUp()
  original.heapifyUp()
  expect(queueState.heap).toEqual(originalState.heap)
  expect(queue.dequeue()).toBeNull()
})
