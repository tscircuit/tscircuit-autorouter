import { expect, test } from "bun:test";
import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue";

const createNode = (f: number): Node => ({
  x: f,
  y: 0,
  z: 0,
  g: 0,
  h: 0,
  f,
  parent: null,
});

test("SingleRouteCandidatePriorityQueue preserves ascending priority", () => {
  const priorities = [8, 3, 5, 1, 9, 2, 7, 4, 6, 0];
  const queue = new SingleRouteCandidatePriorityQueue(
    priorities.map(createNode),
  );
  const dequeued: number[] = [];

  while (queue.peek()) {
    dequeued.push(queue.dequeue()!.f);
  }

  expect(dequeued).toEqual([...priorities].sort((a, b) => a - b));
  expect(queue.dequeue()).toBeNull();
});

test("SingleRouteCandidatePriorityQueue handles equal and single priorities", () => {
  const queue = new SingleRouteCandidatePriorityQueue([
    createNode(2),
    createNode(2),
    createNode(2),
  ]);

  expect(queue.dequeue()?.f).toBe(2);
  expect(queue.dequeue()?.f).toBe(2);
  expect(queue.dequeue()?.f).toBe(2);
  expect(queue.dequeue()).toBeNull();
});
