import { expect, test } from "bun:test"
import * as bindings from "../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { initializeAutorouterBindings } from "../lib/bindings/initializeAutorouterBindings"

test("high-density JSON preserves Map projection and getter/toJSON semantics", (): void => {
  initializeAutorouterBindings()
  const accesses: string[] = []
  const metadata = {
    get first(): object {
      accesses.push("first")
      return { toJSON(key: string): Map<string, unknown> {
        accesses.push(`toJSON:${key}`)
        return new Map([["nested", new Map([["value", accesses.length]])]])
      } }
    },
    get second(): number { accesses.push("second"); return accesses.length },
  }
  const node = {
    capacityMeshNodeId: "json-maps", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0, 1], portPoints: [], metadata,
  }
  const expected = JSON.parse(JSON.stringify(node, (_key, value): unknown => value instanceof Map ? Object.fromEntries(value) : value))
  const expectedAccesses = [...accesses]
  accesses.length = 0
  const solver = new bindings.SpecializedIntraNodeDispatcher("single-transition", { nodeWithPortPoints: node })
  try {
    expect(accesses).toEqual(expectedAccesses)
    expect(solver.snapshot().nodeWithPortPoints).toEqual(expected)
  } finally {
    solver.free()
  }
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  expect(() => new bindings.SpecializedIntraNodeDispatcher("single-transition", cycle)).toThrow(TypeError)
  const failure = new Error("metadata getter failed")
  try {
    new bindings.SpecializedIntraNodeDispatcher("single-transition", { get nodeWithPortPoints(): never { throw failure } })
    throw new Error("Expected the getter failure")
  } catch (error) {
    expect(error).toBe(failure)
  }
})
