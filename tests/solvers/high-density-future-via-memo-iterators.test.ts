import { expect, test } from "bun:test"
import { createFutureViaNode, createFutureViaSolver, originalFutureViaClearance } from "tests/fixtures/future-via-memo"

test("custom segment iterators, iterator next and inherited close hooks remain observable on memo hits", () => {
  const arrayIterator = Array.prototype[Symbol.iterator]
  const iteratorPrototype = Object.getPrototypeOf(arrayIterator.call([]))
  const parentIteratorPrototype = Object.getPrototypeOf(iteratorPrototype)
  const originalNext = iteratorPrototype.next
  for (const kind of ["own", "own getter", "inherited", "global", "global getter", "next", "next getter", "return", "return getter"]) {
    const solver = createFutureViaSolver(true)
    const node = createFutureViaNode(0.05)
    const segments = solver.getFutureConnectionSegments()
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
    const events: string[] = []
    const customIterator = function (this: typeof segments): ArrayIterator<(typeof segments)[number]> {
      events.push("iterator call")
      return arrayIterator.call(this)
    }
    const customNext = function (this: ArrayIterator<unknown>): IteratorResult<unknown> {
      events.push("next call")
      return Reflect.apply(originalNext, this, [])
    }
    const customReturn = (): IteratorResult<unknown> => {
      events.push("return call")
      return { value: undefined, done: true }
    }
    let owner: object = segments
    let key: PropertyKey = Symbol.iterator
    let replacement: PropertyDescriptor = { configurable: true, writable: true, value: customIterator }
    const oldPrototype = Object.getPrototypeOf(segments)
    if (kind === "inherited") owner = Object.create(Array.prototype)
    if (kind.startsWith("global")) owner = Array.prototype
    if (kind.startsWith("next")) {
      owner = iteratorPrototype
      key = "next"
      replacement.value = customNext
    }
    if (kind.startsWith("return")) {
      owner = parentIteratorPrototype
      key = "return"
      replacement.value = customReturn
    }
    if (kind.endsWith("getter")) {
      const value = replacement.value
      replacement = {
        configurable: true,
        get: (): typeof value => { events.push(`${String(key)} getter`); return value },
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)
    let expected: boolean[] = []
    let actual: boolean[] = []
    let expectedEvents: string[] = []
    let actualEvents: string[] = []
    try {
      Object.defineProperty(owner, key, replacement)
      if (kind === "inherited") Object.setPrototypeOf(segments, owner)
      expected = [originalFutureViaClearance(solver, node), originalFutureViaClearance(solver, node)]
      expectedEvents = events.splice(0)
      actual = [solver.isViaTooCloseToFutureConnectionTrace(node), solver.isViaTooCloseToFutureConnectionTrace(node)]
      actualEvents = events.splice(0)
    } finally {
      Object.setPrototypeOf(segments, oldPrototype)
      if (descriptor) Object.defineProperty(owner, key, descriptor)
      else Reflect.deleteProperty(owner, key)
    }
    expect({ kind, actual }).toEqual({ kind, actual: expected })
    expect({ kind, actualEvents }).toEqual({ kind, actualEvents: expectedEvents })
    expect(actualEvents.length).toBeGreaterThan(0)
  }
  const solver = createFutureViaSolver(true)
  const node = createFutureViaNode(0.05)
  expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
  const events: string[] = []
  const proxyParent = new Proxy(parentIteratorPrototype, {
    has(target, key): boolean {
      events.push(`has ${String(key)}`)
      return Reflect.has(target, key)
    },
    get(target, key, receiver): unknown {
      events.push(`get ${String(key)}`)
      return Reflect.get(target, key, receiver)
    },
  })
  let expected = false
  let actual = false
  let expectedEvents: string[] = []
  let actualEvents: string[] = []
  try {
    Object.setPrototypeOf(iteratorPrototype, proxyParent)
    expected = originalFutureViaClearance(solver, node)
    expectedEvents = events.splice(0)
    actual = solver.isViaTooCloseToFutureConnectionTrace(node)
    actualEvents = events.splice(0)
  } finally {
    Object.setPrototypeOf(iteratorPrototype, parentIteratorPrototype)
  }
  expect(actual).toBe(expected)
  expect(expectedEvents).toEqual(["get return"])
  expect(actualEvents).toEqual(expectedEvents)
})
