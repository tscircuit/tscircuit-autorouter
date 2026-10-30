import { expect, test } from "bun:test"
import {
  SingleRouteCandidatePriorityQueue,
  type Node,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { OriginalSingleRouteQueue } from "../fixtures/OriginalSingleRouteQueue"

test("parallel heap priorities preserve reference tie order and interleaved operations", (): void => {
  const actual = new SingleRouteCandidatePriorityQueue<Node>([])
  const reference = new OriginalSingleRouteQueue<Node>([])
  let state = 817231
  for (let i = 0; i < 50000; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    if (state % 5 < 3) {
      const f = state % 101
      const node: Node = { x: i, y: 0, z: 0, f, g: f, h: 0, parent: null }
      actual.enqueue(node)
      reference.enqueue(node)
    } else {
      expect(actual.dequeue()).toBe(reference.dequeue())
    }
    expect(actual.peek()).toBe(reference.peek())
  }
  while (reference.peek()) expect(actual.dequeue()).toBe(reference.dequeue())
  expect(actual.dequeue()).toBeNull()
})
