import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "../lib/types"

type StageRecord = { name: string; hash: string; bytes: number }
type Baseline = {
  bun: string
  platform: string
  arch: string
  inputHash: string
  modules: Record<string, string>
  stages: StageRecord[]
}

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error("Expected output directory")
mkdirSync(outputDirectory, { recursive: true })
const baselinePath = process.argv[3]
const baseline: Baseline | undefined = baselinePath
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : undefined
const stopAfterStage = process.argv[4]
const root = process.cwd()
const inputText = readFileSync(
  "tests/repro/assets/gameboy-full-board-through-vias.srj.json",
  "utf8",
)
const inputSrj = JSON.parse(inputText) as SimpleRouteJson

function hash(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex")
}

// Preserve array, object-key, Map and Set order: routing can depend on order.
// Reference markers preserve sharing/cycles without changing the observed data.
function encode(value: unknown, seen = new Map<object, number>()): unknown {
  if (value === undefined) return { $undefined: true }
  if (typeof value === "function") return { $function: value.toString() }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { $number: String(value) }
  }
  if (typeof value === "bigint") return { $bigint: String(value) }
  if (value === null || typeof value !== "object") return value
  if (seen.has(value)) return { $ref: seen.get(value) }
  const id = seen.size
  seen.set(value, id)
  if (value instanceof Map) {
    return { $id: id, $map: [...value].map(([k, v]) => [encode(k, seen), encode(v, seen)]) }
  }
  if (value instanceof Set) return { $id: id, $set: [...value].map((v) => encode(v, seen)) }
  if (Array.isArray(value)) return { $id: id, $array: value.map((v) => encode(v, seen)) }
  return {
    $id: id,
    $type: value.constructor?.name,
    $entries: Object.entries(value).map(([key, entry]) => [key, encode(entry, seen)]),
  }
}

const modules: Record<string, string> = {}
for (const filename of Object.keys(require.cache).sort()) {
  if (!existsSync(filename)) continue
  const relative = path.relative(root, filename)
  if (relative.startsWith("..")) throw new Error(`Module outside checkout: ${filename}`)
  if (relative === "scripts/diagnose-gameboy-platform.ts") continue
  modules[relative] = hash(readFileSync(filename))
}
const result: Baseline = {
  bun: Bun.version,
  platform: process.platform,
  arch: process.arch,
  inputHash: hash(inputText),
  modules,
  stages: [],
}
writeFileSync(path.join(outputDirectory, "manifest.json"), JSON.stringify(result, null, 2))
if (baseline) {
  if (baseline.bun !== result.bun || baseline.inputHash !== result.inputHash) {
    throw new Error("Bun version or input differs before routing")
  }
  const differentModules = [...new Set([...Object.keys(modules), ...Object.keys(baseline.modules)])]
    .filter((filename) => modules[filename] !== baseline.modules[filename])
  if (differentModules.length > 0) {
    writeFileSync(path.join(outputDirectory, "first-difference.json"), JSON.stringify({
      phase: "module-resolution", differentModules,
    }, null, 2))
    console.log("STOP: loaded source differs before routing", differentModules)
    process.exit(2)
  }
}

class ComparisonStop extends Error {}

const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
  cacheProvider: null,
  effort: 1,
})
for (const definition of solver.pipelineDef) {
  const getConstructorParams = definition.getConstructorParams
  definition.getConstructorParams = (pipeline): ReturnType<typeof getConstructorParams> => {
    const parameters = getConstructorParams(pipeline)
    const serialized = JSON.stringify(encode(parameters))
    const record = { name: definition.solverName, hash: hash(serialized), bytes: serialized.length }
    const expected = baseline?.stages[result.stages.length]
    result.stages.push(record)
    writeFileSync(path.join(outputDirectory, "manifest.json"), JSON.stringify(result, null, 2))
    console.log("STAGE_INPUT", JSON.stringify(record))
    if (baseline && (expected?.name !== record.name || expected.hash !== record.hash)) {
      writeFileSync(path.join(outputDirectory, "first-difference.json"), JSON.stringify({
        phase: definition.solverName, expected, actual: record,
      }, null, 2))
      writeFileSync(path.join(outputDirectory, "first-difference-input.json.gz"), gzipSync(serialized))
      throw new ComparisonStop(`First difference at input to ${definition.solverName}`)
    }
    if (definition.solverName === stopAfterStage) {
      writeFileSync(path.join(outputDirectory, "selected-stage-input.json.gz"), gzipSync(serialized))
      throw new ComparisonStop(`Captured input to ${definition.solverName}`)
    }
    // Forward exactly the same objects; the observer never changes solver inputs.
    return parameters
  }
}
try {
  solver.solve()
} catch (error) {
  if (!(error instanceof ComparisonStop)) throw error
  console.log("STOP", error.message)
  process.exit(2)
}
if (!solver.solved || solver.failed) throw new Error(solver.error ?? "Solve did not complete")
const routedTraces = solver.getOutputSimplifiedPcbTraces()
const { errors, circuitJson } = evaluateRelaxedDrc({
  inputSrj,
  srjWithPointPairs: solver.srjWithPointPairs!,
  routedTraces,
})
const final = {
  routeHash: hash(JSON.stringify(routedTraces)),
  traces: routedTraces.length,
  vias: circuitJson.filter((element) => element.type === "pcb_via").length,
  drcs: errors.length,
}
console.log("FINAL", JSON.stringify(final))
writeFileSync(path.join(outputDirectory, "final.json"), JSON.stringify(final, null, 2))
