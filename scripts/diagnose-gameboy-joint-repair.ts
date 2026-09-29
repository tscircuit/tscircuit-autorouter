import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync, gzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GlobalDrcBranchPortfolioSolver, GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

type EncodedObject = {
  $id?: number
  $ref?: number
  $undefined?: boolean
  $array?: unknown[]
  $set?: unknown[]
  $map?: [unknown, unknown][]
  $type?: string
  $entries?: [string, unknown][]
}
type RepairSolver = GlobalDrcBranchPortfolioSolver | GlobalDrcForceImproveSolver
type RecordEntry = {
  key: string
  hash: string
  phase: unknown
  solved: boolean
  failed: boolean
}

function decode(value: unknown, seen = new Map<number, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value
  const encoded = value as EncodedObject
  if (encoded.$undefined) return undefined
  if (encoded.$ref !== undefined) {
    if (!seen.has(encoded.$ref)) throw new Error(`Unknown reference ${encoded.$ref}`)
    return seen.get(encoded.$ref)
  }
  if (encoded.$id === undefined) throw new Error("Missing captured object ID")
  if (encoded.$array) {
    const array: unknown[] = []
    seen.set(encoded.$id, array)
    for (const entry of encoded.$array) array.push(decode(entry, seen))
    return array
  }
  if (encoded.$map) {
    const map = new Map<unknown, unknown>()
    seen.set(encoded.$id, map)
    for (const [key, entry] of encoded.$map) map.set(decode(key, seen), decode(entry, seen))
    return map
  }
  if (encoded.$set) {
    const set = new Set<unknown>()
    seen.set(encoded.$id, set)
    for (const entry of encoded.$set) set.add(decode(entry, seen))
    return set
  }
  if (encoded.$type !== "Object" && encoded.$type !== "ConnectivityMap") {
    throw new Error(`Unsupported captured type ${encoded.$type}`)
  }
  if (!encoded.$entries) throw new Error("Missing captured object entries")
  const result: Record<string, unknown> = encoded.$type === "ConnectivityMap"
    ? Object.create(ConnectivityMap.prototype) : {}
  seen.set(encoded.$id, result)
  for (const [key, entry] of encoded.$entries) result[key] = decode(entry, seen)
  return result
}

const [inputDirectory, outputDirectory] = process.argv.slice(2)
if (!inputDirectory || !outputDirectory) throw new Error("Expected input and output directories")
mkdirSync(outputDirectory, { recursive: true })
const [parameters] = decode(JSON.parse(gunzipSync(readFileSync(
  `${inputDirectory}/pipeline9JointDrcRepairSolver-input.json.gz`,
)).toString())) as ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>
const [nextParameters] = decode(JSON.parse(gunzipSync(readFileSync(
  `${inputDirectory}/lengthMatchingPostProcessingSolver-input.json.gz`,
)).toString())) as [{ hdRoutes: unknown }]
const records: RecordEntry[] = []
const identifiers = new Map<RepairSolver, number>()
const written = new Set<string>()

function capture(solver: RepairSolver, event: string): void {
  if (!identifiers.has(solver)) identifiers.set(solver, identifiers.size)
  const serialized = JSON.stringify(solver.getOutput())
  const hash = createHash("sha256").update(serialized).digest("hex")
  if (!written.has(hash)) {
    writeFileSync(`${outputDirectory}/${hash}.json.gz`, gzipSync(serialized))
    written.add(hash)
  }
  const key = `${identifiers.get(solver)}-${solver.constructor.name}-${solver.iterations}-${event}`
  records.push({ key, hash, phase: Reflect.get(solver, "phase"), solved: solver.solved, failed: solver.failed })
}

const originalForceStep = GlobalDrcForceImproveSolver.prototype._step
GlobalDrcForceImproveSolver.prototype._step = function (this: GlobalDrcForceImproveSolver): void {
  capture(this, "before")
  originalForceStep.call(this)
  capture(this, "after")
}
const originalPortfolioStep = GlobalDrcBranchPortfolioSolver.prototype._step
GlobalDrcBranchPortfolioSolver.prototype._step = function (this: GlobalDrcBranchPortfolioSolver): void {
  capture(this, "before")
  originalPortfolioStep.call(this)
  capture(this, "after")
}

const solver = new Pipeline9JointDrcRepairSolver(parameters)
solver.solve()
writeFileSync(`${outputDirectory}/records.json`, JSON.stringify(records, null, 2))
writeFileSync(`${outputDirectory}/stats.json`, JSON.stringify(solver.stats, null, 2))
if (!solver.solved || solver.failed) throw new Error(`Joint repair failed: ${solver.error}`)
const actual = JSON.stringify(solver.getOutput())
writeFileSync(`${outputDirectory}/output.json.gz`, gzipSync(actual))
if (actual !== JSON.stringify(nextParameters.hdRoutes)) {
  throw new Error("Stage replay does not match the full-board stage output")
}
console.log("Replay exactly matches the captured full-board stage output", { observations: records.length, uniqueOutputs: written.size })
