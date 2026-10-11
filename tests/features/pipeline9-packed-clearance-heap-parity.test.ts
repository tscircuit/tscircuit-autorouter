import { expect, test } from "bun:test"
import { ClearancePathHeap } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/ClearancePathHeap"

test("packed clearance queues preserve tie order, decrease-key, capacity growth and node reuse", (): void => {
  const legacy = new ClearancePathHeap()
  const packed = new ClearancePathHeap(4096)
  const active = new Map<number, { cost: number; priority: number }>()
  const scratch = { id: 0, cost: 0, priority: 0 }
  for (let id = 0; id < 1536; id++) {
    const value = { id, cost: id === 0 ? -0 : id / 7, priority: (id % 11) / 3 }
    legacy.push(value)
    packed.pushValues(value.id, value.cost, value.priority)
    active.set(id, value)
  }
  for (const [id, value] of active) {
    if (id % 13 !== 0) continue
    const updated = { id, cost: value.cost - .125, priority: value.priority - 2 }
    legacy.push(updated)
    packed.push(updated)
    active.set(id, updated)
  }
  let popped = 0
  while (legacy.length) {
    const expected = legacy.pop()
    const actual = popped % 2 === 0 ? packed.popInto(scratch) : packed.pop()
    expect(actual).toEqual(expected)
    expect(Object.is(actual.cost, expected.cost)).toBe(true)
    active.delete(actual.id)
    expect(packed.length).toBe(legacy.length)
    if (popped < 100 && popped % 3 === 0) {
      const value = { id: actual.id, cost: actual.cost + 1, priority: actual.priority + 1 }
      legacy.push(value)
      packed.pushValues(value.id, value.cost, value.priority)
      active.set(value.id, value)
    }
    popped++
  }
  expect(popped).toBe(1570)
  expect(active.size).toBe(0)
  expect(packed.length).toBe(0)
  expect(() => packed.popInto(scratch)).toThrow("cannot pop an empty")
  packed.pushValues(7, 1, 1)
  expect(() => packed.pushValues(7, 1, 2)).toThrow("may only decrease")
  expect(packed.pop()).toEqual({ id: 7, cost: 1, priority: 1 })
})
