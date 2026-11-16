import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { fileURLToPath } from "node:url"

const [originalArg, spacedArg, outputArg, onlyId] = process.argv.slice(2)
if (!originalArg || !spacedArg || !outputArg) throw new Error("Usage: prepare-cases.ts ORIGINAL_EXPERIMENT_DIR SPACED_REPO_DIR OUTPUT [BOARD_ID]")
const originalRoot = resolve(originalArg), spacedRoot = resolve(spacedArg), output = resolve(outputArg)
const manifestPath = process.env.FULL_BOARD_RUNTIME_MANIFEST
if (!manifestPath) throw new Error("FULL_BOARD_RUNTIME_MANIFEST must name the verified compatible published package chain")
const runtimeManifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const digest = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex")
mkdirSync(output, { recursive: true })
if (!existsSync(join(output, "node_modules"))) symlinkSync(realpathSync(join(import.meta.dir, "node_modules")), join(output, "node_modules"))

// Assessment-only adapter: exact published bytes plus one export, never a render import.
const coreEntry = fileURLToPath(import.meta.resolve("@tscircuit/core"))
const coreIdentity = runtimeManifest.packages.find((row: any) => row.name === "@tscircuit/core")
if (!coreIdentity || digest(readFileSync(coreEntry)) !== coreIdentity.entrySha256) throw new Error("Assessment Core prefix does not match the compatible published runtime")
const coreBytes = readFileSync(coreEntry)
if (!coreBytes.includes(Buffer.from("var findFloatingCopper ="))) throw new Error("Published Core changed helper layout; inspect before running")
const helperRoot = join(output, "assessment-core")
mkdirSync(helperRoot, { recursive: true })
// Give the copied bundle its own scope instead of the checkout's AR self-reference.
writeFileSync(join(helperRoot, "package.json"), JSON.stringify({ name: "published-core-assessment", private: true, type: "module" }, null, 2))
const tail = "\nexport { findFloatingCopper as benchmarkFindFloatingCopper };\n"
const files: any[] = []
for (const name of readdirSync(dirname(coreEntry)).filter(name => name.endsWith(".js"))) {
  const bytes = readFileSync(join(dirname(coreEntry), name))
  const final = name === "index.js" ? Buffer.concat([bytes, Buffer.from(tail)]) : bytes
  writeFileSync(join(helperRoot, name), final)
  files.push({ name, originalSha256: digest(bytes), outputSha256: digest(final), prefixExact: true, appendedTail: name === "index.js" ? tail : "" })
}
const bridge = join(output, "find-floating-copper-assessment.mjs")
writeFileSync(bridge, 'export { benchmarkFindFloatingCopper as findFloatingCopper } from "./assessment-core/index.js"\n')
writeFileSync(join(output, "assessment-helper-proof.json"), JSON.stringify({ assessmentOnly: true, coreIdentity, files, rendererNeverImportsThisAdapter: true }, null, 2))

const knownIds = ["h616", "butterstick", "glider", "imx6", "icepi"]
if (onlyId && !knownIds.includes(onlyId)) throw new Error("Unknown board ID")
const rows: any[] = []
for (const id of onlyId ? [onlyId] : knownIds) for (const cohort of ["original", "spaced"]) {
  const sourcePath = cohort === "original" ? join(originalRoot, id, "source.json") : join(spacedRoot, "full-boards", `${id}.json.gz`)
  const bytes = readFileSync(sourcePath)
  const source = JSON.parse((cohort === "original" ? bytes : gunzipSync(bytes)).toString())
  const boardModule = cohort === "original" ? join(originalRoot, id, "board.tsx") : join(spacedRoot, "full-boards", `${id}.tsx`)
  const layoutModule = cohort === "spaced" ? join(spacedRoot, "full-boards/peripheral-layout.ts") : undefined
  const implementation = cohort === "original" ? [boardModule, join(originalRoot, "native-full-board.tsx"), join(originalRoot, "native-part.tsx")] : [boardModule, join(spacedRoot, "full-boards/native-full-board.tsx"), layoutModule!]
  const assessmentRoot = cohort === "original" ? originalRoot : spacedRoot
  const assessorFiles = cohort === "original" ? [join(originalRoot, "assess.ts"), join(originalRoot, "connectivity.ts")] : [join(spacedRoot, "scripts/assess.ts"), join(spacedRoot, "scripts/connectivity.ts"), join(spacedRoot, "scripts/audit-full-board-geometry.ts")]
  const task = {
    id, cohort, mode: "phased", fanout: false, planes: cohort === "original",
    sourcePath, sourceSha256: digest(bytes), boardModule, layoutModule,
    implementationFiles: implementation.map(path => ({ path, sha256: digest(readFileSync(path)) })),
    expectedComponents: source.parts.length,
    expectedPads: source.parts.reduce((sum: number, part: any) => sum + part.pads.length, 0),
    expectedNativeNets: cohort === "original" ? source.nets.length : source.traces.length,
    expectedNets: cohort === "original" ? source.nets.length : source.traces.filter((trace: any) => trace.path.length > 1).length,
    expectedRoutableNets: cohort === "original" ? source.nets.filter((net: any) => net.routable).length : source.traces.filter((trace: any) => trace.path.length > 1).length,
    assessmentRoot, assessorModule: cohort === "original" ? join(originalRoot, "assess.ts") : join(spacedRoot, "scripts/assess.ts"),
    assessmentSourceFiles: assessorFiles.map(path => ({ path, sha256: digest(readFileSync(path)) })),
    assessmentCopperModule: cohort === "original" ? bridge : undefined,
    assessmentHelperProof: cohort === "original" ? join(output, "assessment-helper-proof.json") : undefined,
    runtimeRoot: import.meta.dir, runtimeManifestPath: resolve(manifestPath),
    captureDeadlineMs: 900000, hardDeadlineMs: 960000, assessmentDeadlineMs: 180000,
  }
  const caseFile = join(output, `${id}-${cohort}.json`)
  writeFileSync(caseFile, JSON.stringify(task, null, 2))
  rows.push({ id, cohort, caseFile, expectedRoutableNets: task.expectedRoutableNets })
}
writeFileSync(join(output, "cases.json"), JSON.stringify(rows, null, 2))
console.log(JSON.stringify({ cases: rows, helperProof: join(output, "assessment-helper-proof.json"), circuitExecution: false }))
