import { expect, test } from "bun:test"
import { deepStrictEqual } from "node:assert"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import {
  ConnectivityMap,
  findConnectedNetworks,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import { findOrderedIndexedConnectedNetworks } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/findOrderedIndexedConnectedNetworks"
import { getOrderedIndexedFullConnectivityMap } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/getOrderedIndexedFullConnectivityMap"

test("indexed fresh graph construction preserves native net IDs, deletion gaps, ordered unions and full captured logical maps", (): void => {
  const compare = (connections: string[][]): void => {
    const expected = findConnectedNetworks(connections)
    const actual = findOrderedIndexedConnectedNetworks(connections)
    deepStrictEqual(actual, expected)
    const nativeMap = new ConnectivityMap(expected)
    const actualMap = new ConnectivityMap(actual)
    deepStrictEqual(actualMap.idToNetMap, nativeMap.idToNetMap)
    deepStrictEqual(Object.keys(actualMap.netMap), Object.keys(nativeMap.netMap))
  }
  for (const connections of [
    [], [[]], [["a", "b"], ["c"], ["b", "c"]],
    [["a"], ["b"], ["c", "a"], ["b", "c"], ["d", "e"]],
    [["__proto__", "constructor"], ["", "toString"], ["__proto__", ""]],
    [["a", "a", "b", "b"], [], ["b", "c", "a"], ["d", "e", "f"]],
  ]) compare(connections)
  let randomState = 0x9180
  const random = (): number => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState
  }
  for (let scenario = 0; scenario < 10_000; scenario++) {
    const connections: string[][] = []
    for (let row = 0, count = random() % 70; row < count; row++) {
      const connection: string[] = []
      for (let member = 0, count = random() % 8; member < count; member++)
        connection.push(`node${random() % 35}`)
      connections.push(connection)
    }
    compare(connections)
  }
  const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
    "../fixtures/reference-drc-srj18/sample015-native-reference.json.gz",
    import.meta.url,
  )))).toString()) as { records: Array<{ circuitJson: AnyCircuitElement[] }> }
  expect(fixture.records).toHaveLength(17)
  for (const { circuitJson } of fixture.records) {
    const original = structuredClone(circuitJson)
    const native = getFullConnectivityMapFromCircuitJson(circuitJson)
    const actual = getOrderedIndexedFullConnectivityMap(circuitJson)
    deepStrictEqual(actual.netMap, native.netMap)
    deepStrictEqual(actual.idToNetMap, native.idToNetMap)
    deepStrictEqual(Object.keys(actual.netMap), Object.keys(native.netMap))
    for (const [id, netId] of Object.entries(native.idToNetMap)) {
      expect(actual.getNetConnectedToId(id)).toBe(netId)
      deepStrictEqual(actual.getIdsConnectedToNet(netId), native.getIdsConnectedToNet(netId))
    }
    deepStrictEqual(circuitJson, original)
  }
  const malformed = new RangeError("native live source connection getter")
  const source = { type: "source_trace", source_trace_id: "s" }
  Object.defineProperty(source, "connected_source_port_ids", {
    get: (): never => { throw malformed },
  })
  for (const builder of [getFullConnectivityMapFromCircuitJson, getOrderedIndexedFullConnectivityMap]) {
    let caught: unknown
    try { builder([source as AnyCircuitElement]) } catch (error) { caught = error }
    expect(caught).toBe(malformed)
  }
})
