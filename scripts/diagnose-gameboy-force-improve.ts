import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gzipSync, gunzipSync } from "node:zlib"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"

type EntryResult = { index: number; nodeId: string; hash: string; routes: unknown }
type Difference = { path: string; expected: unknown; actual: unknown }

function decode(value: any, seen = new Map<number, any>()): any {
  if (value === null || typeof value !== "object") return value
  if ("$undefined" in value) return undefined
  if ("$ref" in value) {
    if (!seen.has(value.$ref)) throw new Error(`Unknown reference ${value.$ref}`)
    return seen.get(value.$ref)
  }
  if ("$array" in value) {
    const array: unknown[] = []
    seen.set(value.$id, array)
    for (const item of value.$array) array.push(decode(item, seen))
    return array
  }
  if (value.$type !== "Object") throw new Error(`Unsupported captured type ${value.$type}`)
  const result: Record<string, unknown> = {}
  seen.set(value.$id, result)
  for (const [key, entry] of value.$entries) result[key] = decode(entry, seen)
  return result
}

function firstDifference(expected: any, actual: any, field = "routes"): Difference | undefined {
  if (Object.is(expected, actual)) return undefined
  if (expected === null || actual === null || typeof expected !== "object" || typeof actual !== "object") {
    return { path: field, expected, actual }
  }
  if (Array.isArray(expected) && expected.length !== actual.length) {
    return { path: `${field}.length`, expected: expected.length, actual: actual.length }
  }
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const difference = firstDifference(expected[key], actual[key], `${field}.${key}`)
    if (difference) return difference
  }
  return undefined
}

const [inputFile, outputDirectory, baselineFile] = process.argv.slice(2)
if (!inputFile || !outputDirectory) throw new Error("Expected input and output paths")
mkdirSync(outputDirectory, { recursive: true })
const encoded = gunzipSync(readFileSync(inputFile)).toString()
const inputHash = createHash("sha256").update(encoded).digest("hex")
if (inputHash !== "9ae74e0690a2c210dedb6143414f89deafc82127eafc47aa71a94632a196bf49") {
  throw new Error("Captured force-improve input does not match both full-board runs")
}
const [parameters] = decode(JSON.parse(encoded)) as ConstructorParameters<typeof HighDensityForceImproveSolver>
const baseline: EntryResult[] | undefined = baselineFile
  ? JSON.parse(gunzipSync(readFileSync(baselineFile)).toString())
  : undefined
const solver = new HighDensityForceImproveSolver(parameters)
const results: EntryResult[] = []
while (!solver.solved && !solver.failed) {
  const index = solver.activeSampleIndex
  const entry = solver.sampleEntries[index]
  solver.step()
  const routes = entry.routeIndexes.map((routeIndex) => solver.improvedRoutesByIndex.get(routeIndex))
  const record = {
    index,
    nodeId: entry.node.capacityMeshNodeId,
    hash: createHash("sha256").update(JSON.stringify(routes)).digest("hex"),
    routes,
  }
  results.push(record)
  if (baseline && record.hash !== baseline[index]?.hash) {
    const difference = firstDifference(baseline[index]?.routes, routes)
    const details = {
      platform: process.platform, arch: process.arch, bun: Bun.version,
      index, node: entry.node, routeIndexes: entry.routeIndexes,
      inputRoutes: entry.routeIndexes.map((i) => parameters.hdRoutes[i]),
      expected: baseline[index], actual: record, difference,
    }
    writeFileSync(`${outputDirectory}/first-node-difference.json`, JSON.stringify(details, null, 2))
    console.log("FIRST_NODE_DIFFERENCE", JSON.stringify({ index, nodeId: record.nodeId, difference }))
    process.exit(2)
  }
}
if (solver.failed) throw new Error(solver.error ?? "Force improvement failed")
writeFileSync(`${outputDirectory}/node-results.json.gz`, gzipSync(JSON.stringify(results)))
console.log("FORCE_IMPROVE_RESULT", JSON.stringify({ platform: process.platform, arch: process.arch, samples: results.length, outputHash: createHash("sha256").update(JSON.stringify(solver.getOutput())).digest("hex") }))
