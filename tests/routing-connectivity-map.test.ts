import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { RoutingConnectivityMap } from "../lib/utils/RoutingConnectivityMap"

test("routing connectivity queries match the reference before and after net merges", (): void => {
  const initialNets = {
    first: ["a", "b"],
    second: ["c", "d"],
    aliasOwner: ["first"],
  }
  const reference = new ConnectivityMap(structuredClone(initialNets))
  const routing = new RoutingConnectivityMap(structuredClone(initialNets))
  const ids = [
    "a",
    "b",
    "c",
    "d",
    "e",
    "unknown",
    "first",
    "second",
    "constructor",
    "__proto__",
    "toString",
  ]
  const additions = [[], [["b", "c"]], [["d", "e"]], [["new", "another"]]]

  expect(routing.areIdsConnected("first", "a")).toBe(true)
  expect(routing.areIdsConnected("a", "first")).toBe(false)

  for (const connections of additions) {
    reference.addConnections(connections)
    routing.addConnections(connections)
    expect(routing.netMap).toEqual(reference.netMap)
    expect(routing.idToNetMap).toEqual(reference.idToNetMap)
    for (const first of ids) {
      expect(routing.getNetConnectedToId(first)).toBe(
        reference.getNetConnectedToId(first),
      )
      for (const second of ids) {
        expect(routing.areIdsConnected(first, second)).toBe(
          reference.areIdsConnected(first, second),
        )
        expect(routing.areAllIdsConnected([first, second])).toBe(
          reference.areAllIdsConnected([first, second]),
        )
      }
    }
  }

  // Keep the inherited map's live public-object semantics as well as merges.
  routing.idToNetMap.unknown = "first"
  reference.idToNetMap.unknown = "first"
  expect(routing.getNetConnectedToId("unknown")).toBe(
    reference.getNetConnectedToId("unknown"),
  )
  expect(routing.areIdsConnected("unknown", "a")).toBe(
    reference.areIdsConnected("unknown", "a"),
  )

  const queriesByMap = new WeakMap<ConnectivityMap, string[]>()
  const resolverNets = new Map([
    ["a", "synthetic"],
    ["c", "synthetic"],
    ["alias", "synthetic"],
  ])
  function overriddenResolver(
    this: ConnectivityMap,
    id: string,
  ): string | undefined {
    const queries = queriesByMap.get(this)
    if (!queries) throw new Error("Resolver received the wrong map receiver")
    queries.push(id)
    return resolverNets.get(id)
  }
  function compareResolverDispatch(
    expectedMap: ConnectivityMap,
    actualMap: RoutingConnectivityMap,
  ): void {
    const expectedQueries: string[] = []
    const actualQueries: string[] = []
    queriesByMap.set(expectedMap, expectedQueries)
    queriesByMap.set(actualMap, actualQueries)
    for (const first of [...ids, "alias"]) {
      for (const second of [...ids, "alias"]) {
        expectedQueries.length = 0
        actualQueries.length = 0
        const expected = expectedMap.areIdsConnected(first, second)
        expect(actualMap.areIdsConnected(first, second)).toBe(expected)
        expect(actualQueries).toEqual(expectedQueries)
      }
    }
  }

  const instanceReference = new ConnectivityMap(structuredClone(initialNets))
  const instanceRouting = new RoutingConnectivityMap(
    structuredClone(initialNets),
  )
  instanceReference.getNetConnectedToId = overriddenResolver
  instanceRouting.getNetConnectedToId = overriddenResolver
  compareResolverDispatch(instanceReference, instanceRouting)

  class ResolverReference extends ConnectivityMap {
    override getNetConnectedToId(id: string): string | undefined {
      const queries = queriesByMap.get(this)
      if (!queries) throw new Error("Resolver received the wrong map receiver")
      queries.push(id)
      return resolverNets.get(id)
    }
  }
  class ResolverRouting extends RoutingConnectivityMap {
    override getNetConnectedToId(id: string): string | undefined {
      const queries = queriesByMap.get(this)
      if (!queries) throw new Error("Resolver received the wrong map receiver")
      queries.push(id)
      return resolverNets.get(id)
    }
  }
  compareResolverDispatch(
    new ResolverReference(structuredClone(initialNets)),
    new ResolverRouting(structuredClone(initialNets)),
  )

  const originalResolver = ConnectivityMap.prototype.getNetConnectedToId
  try {
    ConnectivityMap.prototype.getNetConnectedToId = overriddenResolver
    compareResolverDispatch(reference, routing)
  } finally {
    ConnectivityMap.prototype.getNetConnectedToId = originalResolver
  }
  const originalQuery = ConnectivityMap.prototype.areIdsConnected
  try {
    ConnectivityMap.prototype.areIdsConnected = function (
      this: ConnectivityMap,
      first: string,
      second: string,
    ): boolean {
      const queries = queriesByMap.get(this)
      if (!queries) throw new Error("Query received the wrong map receiver")
      queries.push(`pair:${first}:${second}`)
      return first !== second && first.length === second.length
    }
    compareResolverDispatch(reference, routing)
  } finally {
    ConnectivityMap.prototype.areIdsConnected = originalQuery
  }
  expect(routing.areIdsConnected("unknown", "a")).toBe(
    reference.areIdsConnected("unknown", "a"),
  )
})
