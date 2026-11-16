import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { applyBudgetDiagnostic, ORIGINAL_AUTOROUTER_SHA256 } from "./apply-budget-diagnostic.mjs"

const [rootArg, outputArg] = process.argv.slice(2)
if (!rootArg || !outputArg || Bun.version !== "1.4.3") throw new Error("Usage: Bun1.4.3 prepare-entries.mjs VERIFIED_RUNTIME_ROOT OUTPUT")
const root = resolve(rootArg), output = resolve(outputArg)
const manifest = JSON.parse(readFileSync(join(root, "runtime-manifest.json"), "utf8"))
const frozen = JSON.parse(readFileSync(join(import.meta.dir, "experiment.json"), "utf8"))
const hash = value => createHash("sha256").update(value).digest("hex")
if (!frozen.frozen || manifest.mainVersion !== "0.0.3200" || manifest.sourceOverrides || manifest.dependencyOverrides.length) throw new Error("Expected untouched frozen3200 runtime")
assert.deepStrictEqual(new Set(manifest.packages.map(item => item.name)), new Set(Object.keys(frozen.runtime)))
for (const item of manifest.packages) {
  if (frozen.runtime[item.name] !== item.version || hash(readFileSync(item.entry)) !== item.entrySha256) throw new Error("Published runtime identity differs")
}
const original = manifest.packages.find(item => item.name === "@tscircuit/capacity-autorouter")
const folder = join(root, "npm", "autorouter")
if (original.entrySha256 !== ORIGINAL_AUTOROUTER_SHA256 || resolve(original.entry) !== join(folder, "dist", "index.js")) throw new Error("Expected exact published AR1107")
if (hash(readFileSync(join(import.meta.dir, "apply-budget-diagnostic.mjs"))) !== frozen.adapterSha256) throw new Error("Frozen adapter changed")
const candidate = applyBudgetDiagnostic(readFileSync(original.entry, "utf8"))
const { frozen: reviewed, ...expected } = JSON.parse(readFileSync(join(import.meta.dir, "candidate-proof.json"), "utf8"))
if (!reviewed) throw new Error("Diagnostic source is not frozen")
assert.deepStrictEqual(candidate.proof, expected)
const candidateFolder = join(root, "npm", "autorouter-dataset18-budget-diagnostic")
if (existsSync(candidateFolder)) throw new Error("Refuse to replace an existing candidate")
mkdirSync(candidateFolder)
const copyPackage = current => {
  for (const item of readdirSync(current, { withFileTypes: true })) {
    const source = join(current, item.name), target = join(candidateFolder, relative(folder, source))
    if (item.isSymbolicLink() && source === join(folder, "node_modules")) symlinkSync(realpathSync(source), target)
    else if (item.isDirectory()) { mkdirSync(target); copyPackage(source) }
    else if (item.isFile()) {
      if (source === original.entry) writeFileSync(target, candidate.source)
      else linkSync(source, target)
    } else throw new Error("Unexpected published AR package entry")
  }
}
copyPackage(folder)
const candidateEntry = join(candidateFolder, "dist", "index.js")
if (hash(readFileSync(original.entry)) !== ORIGINAL_AUTOROUTER_SHA256 || realpathSync(join(candidateFolder, "node_modules")) !== realpathSync(join(folder, "node_modules"))) throw new Error("Routing dependency graph or original entry changed")
const proof = { diagnosticOnly: true, productionFixProposed: false, source: candidate.proof,
  base: { entry: original.entry, sha256: original.entrySha256 },
  pr: { entry: candidateEntry, sha256: candidate.proof.outputSha256 },
  sharedRoutingDependencies: realpathSync(join(folder, "node_modules")),
  originalRuntimeManifestSha256: hash(readFileSync(join(root, "runtime-manifest.json"))),
  runtimeAliasesRetargeted: false, originalMainCoreAndAssessmentGraphUnchanged: true }
writeFileSync(output, JSON.stringify(proof, null, 2) + "\n")
console.log("DATASET18_ROUTING_ENTRY_PROOF " + JSON.stringify(proof))
