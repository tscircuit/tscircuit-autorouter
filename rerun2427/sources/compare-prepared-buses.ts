import { createHash } from "node:crypto"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"

const [beforeRoot, afterRoot, frozenFolder, nativeFolder] = process.argv.slice(2)
const before = await import(resolve(beforeRoot, "lib/prepare-buses.ts"))
const after = await import(resolve(afterRoot, "lib/prepare-buses.ts"))
const frozenPaths = readdirSync(frozenFolder)
  .filter((name) => name.endsWith(".json"))
  .map((name) => join(frozenFolder, name))
const nativePaths = readdirSync(nativeFolder)
  .filter((name) => ["orangecrab", "h616", "butterstick", "glider", "imx6", "icepi"].includes(name))
  .map((name) => join(nativeFolder, name, "fanout-1-input.json.gz"))
if (frozenPaths.length !== 72 || nativePaths.length !== 6) {
  throw new Error(`Expected 72 frozen + 6 native captures; received ${frozenPaths.length}+${nativePaths.length}`)
}
const reports = []
for (const path of [...frozenPaths, ...nativePaths]) {
  const bytes = readFileSync(path)
  const serialized = path.endsWith(".gz") ? gunzipSync(bytes).toString() : bytes.toString()
  const original = JSON.parse(serialized)
  const cleaned = JSON.parse(serialized)
  const originalSrj = original.simpleRouteJson ?? original.solverParams
  const cleanedSrj = cleaned.simpleRouteJson ?? cleaned.solverParams
  if (!originalSrj || !cleanedSrj) throw new Error(`Missing SRJ in ${path}`)
  const originalBuses = before.prepareFanoutBuses(originalSrj, original.solverOptions)
  const cleanedBuses = after.prepareFanoutBuses(cleanedSrj, cleaned.solverOptions)
  if (JSON.stringify(originalBuses) !== JSON.stringify(cleanedBuses)) {
    throw new Error(`Prepared buses differ for ${path}`)
  }
  reports.push({
    input: path,
    inputSha256: createHash("sha256").update(serialized).digest("hex"),
    buses: originalBuses.length,
    allPreparedBusFieldsIdentical: true,
  })
}
writeFileSync("prepared-bus-equivalence.json", JSON.stringify(reports, null, 2))
console.log("PREPARED_BUS_EQUIVALENCE_REPORT", JSON.stringify(reports))
