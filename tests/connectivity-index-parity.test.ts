import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { ConnectivityMap, findConnectedNetworks } from "circuit-json-to-connectivity-map"
test("indexed connectivity retains original network IDs, membership order and merge aliases", (): void => {
let seed = 17
const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
const results: unknown[] = []
for (let scenario = 0; scenario < 8; scenario++) {
  const connections = Array.from({length: 40}, () => Array.from({length: next() % 5}, () => `id${next() % 50}`))
  results.push(findConnectedNetworks(connections))
  const map = new ConnectivityMap(scenario % 2 ? {custom: ["id0", "id1"], connectivity_net3: ["id2"]} : {})
  for (let index = 0; index < connections.length; index += 5) {
    map.addConnections(connections.slice(index, index + 5))
    results.push(JSON.parse(JSON.stringify({netMap: map.netMap, idToNetMap: map.idToNetMap})))
  }
}
// Golden captured from circuit-json-to-connectivity-map 0.0.34.
expect(createHash("sha256").update(JSON.stringify(results)).digest("hex")).toBe("3ee81232a95b771727cd7d50c55137b49e648a448ee88749797dd1631f3c0a1c")
})
