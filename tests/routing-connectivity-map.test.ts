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
})
