import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"

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
    for (const entry of value.$array) array.push(decode(entry, seen))
    return array
  }
  if ("$map" in value) {
    const map = new Map()
    seen.set(value.$id, map)
    for (const [key, entry] of value.$map) map.set(decode(key, seen), decode(entry, seen))
    return map
  }
  if ("$set" in value) {
    const set = new Set()
    seen.set(value.$id, set)
    for (const entry of value.$set) set.add(decode(entry, seen))
    return set
  }
  if (value.$type !== "Object" && value.$type !== "ConnectivityMap") {
    throw new Error(`Unsupported captured type ${value.$type}`)
  }
  const result: Record<string, unknown> = value.$type === "ConnectivityMap"
    ? Object.create(ConnectivityMap.prototype) : {}
  seen.set(value.$id, result)
  for (const [key, entry] of value.$entries) result[key] = decode(entry, seen)
  return result
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

const [inputFile, outputDirectory, selectedKey] = process.argv.slice(2)
if (!inputFile || !outputDirectory) throw new Error("Expected input and output paths")
mkdirSync(outputDirectory, { recursive: true })
const [parameters] = decode(JSON.parse(gunzipSync(readFileSync(inputFile)).toString()))
const solver = new TraceSimplificationSolver(parameters)
const records: unknown[] = []
let inner: any
let innerParameters: unknown
while (!solver.solved && !solver.failed) {
  const phaseKey = `${solver.simplificationPipelineLoops}-${solver.currentPhase}`
  const active = solver.activeSubSolver
  if (solver.currentPhase === "path_simplification" && active?.activeSubSolver && inner !== active.activeSubSolver) {
    inner = active.activeSubSolver
    innerParameters = inner.getConstructorParams()
    const routeKey = `${phaseKey}-${(active as any).currentUnsimplifiedHdRouteIndex - 1}`
    if (routeKey === selectedKey) {
      writeFileSync(`${outputDirectory}/selected-input.json`, JSON.stringify(innerParameters, null, 2))
      console.log("SELECTED", routeKey, hash(innerParameters))
      process.exit(0)
    }
    records.push({ key: routeKey, kind: "input", hash: hash(innerParameters) })
  }
  solver.step()
  if (inner?.solved && innerParameters) {
    records.push({ key: `${phaseKey}-${(active as any).currentUnsimplifiedHdRouteIndex - 1}`, kind: "output", hash: hash(inner.simplifiedRoute), route: inner.simplifiedRoute })
    innerParameters = undefined
  }
  const nextKey = `${solver.simplificationPipelineLoops}-${solver.currentPhase}`
  if (nextKey !== phaseKey || solver.solved) {
    records.push({ key: phaseKey, kind: "phase-output", hash: hash(solver.hdRoutes) })
    writeFileSync(`${outputDirectory}/${phaseKey}.json.gz`, gzipSync(JSON.stringify(solver.hdRoutes)))
  }
}
if (!solver.solved || solver.failed) throw new Error(`Simplification failed: ${solver.error}`)
writeFileSync(`${outputDirectory}/records.json`, JSON.stringify(records, null, 2))
console.log("SIMPLIFIED", hash(solver.hdRoutes), solver.hdRoutes.length)
