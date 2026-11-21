import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
const [circuitsDirectory, previousModule, updatedModule, reportPath] = process.argv.slice(2)
const previous = await import(resolve(previousModule))
const updated = await import(resolve(updatedModule))
const rows = []
for (const board of readdirSync(circuitsDirectory).sort()) {
  const circuitPath = join(circuitsDirectory, board, "circuit.json.gz")
  if (!Bun.file(circuitPath).size) continue
  const circuitJson = JSON.parse(gunzipSync(readFileSync(circuitPath)).toString())
  const has = Set.prototype.has
  let membershipChecks = 0
  let before, after, beforeChecks, afterChecks
  Set.prototype.has = function (member) {
    membershipChecks++
    return has.call(this, member)
  }
  try {
    before = previous.getFullConnectivityMapFromCircuitJson(circuitJson)
    beforeChecks = membershipChecks
    membershipChecks = 0
    after = updated.getFullConnectivityMapFromCircuitJson(circuitJson)
    afterChecks = membershipChecks
  } finally {
    Set.prototype.has = has
  }
  const row = {
    board, beforeChecks, afterChecks,
    networks: Object.keys(before.netMap).length,
    identicalNetworksAndOrdering: JSON.stringify(before.netMap) === JSON.stringify(after.netMap),
    identicalIdLookupAndOrdering: JSON.stringify(before.idToNetMap) === JSON.stringify(after.idToNetMap),
  }
  if (!row.identicalNetworksAndOrdering || !row.identicalIdLookupAndOrdering) throw Error(JSON.stringify(row))
  rows.push(row)
}
writeFileSync(reportPath, JSON.stringify(rows, null, 2) + "\n")
console.log(JSON.stringify(rows))
