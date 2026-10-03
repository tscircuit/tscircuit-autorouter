import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { IndexedConnectivityMap } from "../lib/utils/IndexedConnectivityMap"

test("indexed connectivity queries match the reference before and after net merges", (): void => {
  const initialNets = { first: ["a", "b"], second: ["c", "d"] }
  const reference = new ConnectivityMap(structuredClone(initialNets))
  const indexed = new IndexedConnectivityMap(structuredClone(initialNets))
  const ids = ["a", "b", "c", "d", "e", "unknown", "first", "second", "constructor", "__proto__", "toString"]
  const additions = [[], [["b", "c"]], [["d", "e"]], [["new", "another"]]]

  for (const connections of additions) {
    reference.addConnections(connections)
    indexed.addConnections(connections)
    expect(indexed.netMap).toEqual(reference.netMap)
    expect(indexed.idToNetMap).toEqual(reference.idToNetMap)
    for (const first of ids) {
      expect(indexed.getNetConnectedToId(first)).toBe(reference.getNetConnectedToId(first))
      for (const second of ids) {
        expect(indexed.areIdsConnected(first, second)).toBe(reference.areIdsConnected(first, second))
        expect(indexed.areAllIdsConnected([first, second])).toBe(reference.areAllIdsConnected([first, second]))
      }
    }
  }
})
