import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

type GraphCensus = { active: boolean; validationCalls: number; objects: number; properties: number; pending: number; linkedPaths: number; maximumDepth: number; nonemptyProvenance: number }
type Replay = { graphValidation: GraphCensus; records: unknown[]; totals: unknown; factStats: unknown; sourceRevision: string; whole17NativeErrorsExact: boolean; primitiveMemoValuesIdsFifoCountersExact: boolean; scaledPolygonRowsDiagnosticsRetainedEdgesExact: boolean; physicalNetIdsAndOriginalTraceAliasesExact: boolean }
const originalRoot = process.env.REFERENCE_PROFILE_ROOT
const scratchRoot = process.env.REFERENCE_VALIDATION_ROOT
const expectedRevision = process.env.REFERENCE_PROFILE_SHA
if (!originalRoot || !scratchRoot || !expectedRevision || resolve(originalRoot) === resolve(scratchRoot)) {
  throw new Error("Provide distinct frozen REFERENCE_PROFILE_ROOT and disposable REFERENCE_VALIDATION_ROOT, plus REFERENCE_PROFILE_SHA")
}
const relativeHelper = "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSourceAliasProvenance.ts"
const helperPath = join(scratchRoot, relativeHelper)
const original = await readFile(join(originalRoot, relativeHelper), "utf8")
assert.equal(await readFile(helperPath, "utf8"), original, "Disposable helper must initially match the frozen source")
const base = await readFile(join(import.meta.dir, "censusNativeReferenceChecker.ts"), "utf8")
const temporary = await mkdtemp(join(tmpdir(), "reference-validation-driver-"))
const directory = resolve(process.env.REFERENCE_VALIDATION_OUTPUT ?? "/tmp/native-reference-validation-proof")
await mkdir(directory, { recursive: true })
const counterDeclaration = "export const nativeGraphCensus = { active: false, validationCalls: 0, objects: 0, properties: 0, pending: 0, linkedPaths: 0, maximumDepth: 0, nonemptyProvenance: 0 }\n"
const proposed = await readFile(resolve(import.meta.dir, "../../../" + relativeHelper), "utf8")
const driver = replaceOnce(replaceOnce(replaceOnce(base,
  'const { captureNativeSourceAliasProvenance } = await import(join(parallel, "nativeSourceAliasProvenance.ts"))',
  'const { captureNativeSourceAliasProvenance, nativeGraphCensus } = await import(join(parallel, "nativeSourceAliasProvenance.ts"))'),
  '    const actual = getDrcErrors(candidateInput, { ...options, traceContinuityChecker: candidate })',
  '    nativeGraphCensus.active = true\n    const actual = getDrcErrors(candidateInput, { ...options, traceContinuityChecker: candidate })\n    nativeGraphCensus.active = false'),
  '    noLocalElapsedComparison: true, noSpeedClaim: true, totals: previous, factStats: stats, records,',
  '    noLocalElapsedComparison: true, noSpeedClaim: true, graphValidation: { ...nativeGraphCensus }, totals: previous, factStats: stats, records,')
const driverPath = join(temporary, "driver.ts")
await writeFile(driverPath, driver)
const replays: Record<string, Replay> = {}
try {
  for (const mode of ["native-paths", "validation-depth"] as const) {
    let source = mode === "native-paths" ? original : proposed
    source = addGraphCounters(source)
    await writeFile(helperPath, counterDeclaration + source)
    const output = join(directory, mode)
    const child = Bun.spawn([process.execPath, driverPath], { cwd: scratchRoot, env: { ...process.env, REFERENCE_PROFILE_ROOT: scratchRoot, REFERENCE_PROFILE_SHA: expectedRevision, REFERENCE_CENSUS_OUTPUT: output }, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (exitCode !== 0) throw new Error(`Validation ${mode} replay failed: ${stderr}\n${stdout}`)
    replays[mode] = JSON.parse(await readFile(join(output, "census.json"), "utf8")) as Replay
  }
} finally {
  await writeFile(helperPath, original)
}
const native = replays["native-paths"]!, candidate = replays["validation-depth"]!
assert.deepStrictEqual(candidate.records, native.records)
assert.deepStrictEqual(candidate.totals, native.totals)
assert.deepStrictEqual(candidate.factStats, native.factStats)
for (const key of ["validationCalls", "objects", "properties", "pending", "maximumDepth", "nonemptyProvenance"] as const) assert.equal(candidate.graphValidation[key], native.graphValidation[key])
assert.equal(candidate.graphValidation.linkedPaths, 0)
assert.equal(native.graphValidation.linkedPaths, native.graphValidation.properties)
const proof = { kind: "Time-free validation-only Native graph traversal census and full seventeen-state differential replay", sourceRevision: expectedRevision,
  scriptSha256: createHash("sha256").update(new Uint8Array(await readFile(import.meta.path))).digest("hex"),
  nativeHelperSha256: createHash("sha256").update(original).digest("hex"),
  candidateHelperSha256: createHash("sha256").update(proposed).digest("hex"), nativeGraphValidation: native.graphValidation, candidateGraphValidation: candidate.graphValidation,
  linkedPathAllocationsRemoved: native.graphValidation.linkedPaths, fullNativeErrorAndPrivateStateParity: true,
  noProductionSourceEdited: true, noLocalElapsedComparison: true, noSpeedClaim: true, native, candidate }
await Bun.write(join(directory, "proof.json"), JSON.stringify(proof, null, 2))
console.log(JSON.stringify({ nativeGraphValidation: native.graphValidation, candidateGraphValidation: candidate.graphValidation, fullNativeErrorAndPrivateStateParity: true, directory }, null, 2))

function replaceOnce(source: string, anchor: string, replacement: string): string {
  const matches = source.split(anchor).length - 1
  if (matches !== 1) {
    throw new Error(`Expected one diagnostic source anchor, received ${matches}: ${anchor}`)
  }
  return source.replace(anchor, replacement)
}

function addGraphCounters(input: string): string {
  let source = input
  source = replaceOnce(source, "  if (++budget.objects > MAX_OBJECTS)", "  if (nativeGraphCensus.active) nativeGraphCensus.objects++\n  if (++budget.objects > MAX_OBJECTS)")
  source = replaceOnce(source, "  return { parent, key, depth }", "  if (nativeGraphCensus.active) { nativeGraphCensus.linkedPaths++; if (depth > nativeGraphCensus.maximumDepth) nativeGraphCensus.maximumDepth = depth }\n  return { parent, key, depth }")
  source = replaceOnce(source, "  budget: Budget): OutputAliasRow[] {", "  budget: Budget): OutputAliasRow[] {\n  if (nativeGraphCensus.active) nativeGraphCensus.validationCalls++")
  source = replaceOnce(source, "  const rows: OutputAliasRow[] = []", "  if (nativeGraphCensus.active && length > 0) nativeGraphCensus.nonemptyProvenance++\n  const rows: OutputAliasRow[] = []")
  source = source.replaceAll("    pending.length--", "    pending.length--\n    if (nativeGraphCensus.active) nativeGraphCensus.pending++")
  source = source.replaceAll("    budget.properties += keys.length", "    budget.properties += keys.length\n    if (nativeGraphCensus.active) nativeGraphCensus.properties += keys.length")
  if (source.includes("function validatePlainGraph(")) {
    source = replaceOnce(source, "      pending[pending.length] = { value: descriptor.value, depth }", "      if (nativeGraphCensus.active && depth > nativeGraphCensus.maximumDepth) nativeGraphCensus.maximumDepth = depth\n      pending[pending.length] = { value: descriptor.value, depth }")
  }
  return source
}
