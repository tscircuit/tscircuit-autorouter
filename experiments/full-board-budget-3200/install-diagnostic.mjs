import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { applyBudgetDiagnostic, ORIGINAL_AUTOROUTER_SHA256 } from "./apply-budget-diagnostic.mjs"

const [rootArg, board] = process.argv.slice(2)
if (!rootArg || !["glider", "imx6"].includes(board)) throw new Error("Usage: install-diagnostic.mjs VERIFIED_RUNTIME_ROOT glider|imx6")
const root = resolve(rootArg)
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.mainVersion !== "0.0.3200" || manifest.sourceOverrides || manifest.budgetDiagnostic || (manifest.dependencyOverrides?.length ?? 0) !== 0) throw new Error("Expected a fresh exact published3200 runtime")
const autorouter = manifest.packages.find(item => item.name === "@tscircuit/capacity-autorouter")
const core = manifest.packages.find(item => item.name === "@tscircuit/core")
if (autorouter?.version !== "0.0.1107" || autorouter.entrySha256 !== ORIGINAL_AUTOROUTER_SHA256 || core?.version !== "0.0.2395") throw new Error("Expected frozen published AR1107 and Core2395")
const originalFolder = join(root, "npm", "autorouter")
if (resolve(autorouter.entry) !== join(originalFolder, autorouter.entryRelative)) throw new Error("Unexpected original AR location")
const casePath = join(root, "cases", `${board}-spaced.json`)
const task = JSON.parse(readFileSync(casePath, "utf8"))
if (task.id !== board || task.cohort !== "spaced" || task.captureDeadlineMs !== 900000 || task.hardDeadlineMs !== 960000 || task.assessmentDeadlineMs !== 180000) throw new Error("Unexpected native candidate case or budget")
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const helperProofPath = join(root, "cases", "assessment-helper-proof.json")
const helperProof = JSON.parse(readFileSync(helperProofPath, "utf8"))
const helperEntry = helperProof.files.find(file => file.name === "index.js")
if (helperProof.coreIdentity?.entrySha256 !== core.entrySha256 || helperEntry?.originalSha256 !== core.entrySha256 || !helperEntry.prefixExact) throw new Error("Original assessment adapter must precede candidate installation")
const helperRoot = join(root, "cases", "assessment-core")
if (sha(readFileSync(join(helperRoot, "index.js"))) !== helperEntry.outputSha256) throw new Error("Assessment adapter bytes do not match their proof")
const helperProofSha256 = sha(readFileSync(helperProofPath))
const originalCoreSha256 = sha(readFileSync(core.entry))
if (originalCoreSha256 !== core.entrySha256) throw new Error("Original Core identity mismatch")
const originalEntry = autorouter.entry
const candidate = applyBudgetDiagnostic(readFileSync(originalEntry, "utf8"))
const frozenProof = JSON.parse(readFileSync(join(import.meta.dir, "candidate-proof.json"), "utf8"))
if (frozenProof.frozen !== true || candidate.proof.outputSha256 !== frozenProof.outputSha256) throw new Error("Budget diagnostic differs from reviewed bytes")
const candidateFolder = join(root, "npm", "autorouter-budget-sufficiency-diagnostic")
if (existsSync(candidateFolder)) throw new Error("Refuse to replace an existing candidate package")
mkdirSync(candidateFolder)
const copyPackage = folder => {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const source = join(folder, item.name), target = join(candidateFolder, relative(originalFolder, source))
    if (item.isSymbolicLink() && source === join(originalFolder, "node_modules")) symlinkSync(realpathSync(source), target)
    else if (item.isDirectory()) { mkdirSync(target); copyPackage(source) }
    else if (item.isFile()) {
      if (source === originalEntry) writeFileSync(target, candidate.source)
      else linkSync(source, target)
    } else throw new Error("Unexpected published AR package entry")
  }
}
copyPackage(originalFolder)
const candidateEntry = join(candidateFolder, autorouter.entryRelative)
const alias = join(root, "runtime", "node_modules", "@tscircuit", "capacity-autorouter")
if (realpathSync(alias) !== originalFolder) throw new Error("Unexpected original AR alias")
// The assessment-only copied Core keeps the original published AR dependency.
const helperScope = join(helperRoot, "node_modules", "@tscircuit")
mkdirSync(helperScope, { recursive: true })
symlinkSync(originalFolder, join(helperScope, "capacity-autorouter"))
unlinkSync(alias)
symlinkSync(candidateFolder, alias)
if (sha(readFileSync(originalEntry)) !== ORIGINAL_AUTOROUTER_SHA256 || sha(readFileSync(core.entry)) !== originalCoreSha256 || sha(readFileSync(helperProofPath)) !== helperProofSha256) throw new Error("Original packages or assessment proof changed")
if (realpathSync(Bun.resolveSync("@tscircuit/capacity-autorouter", join(root, "runtime"))) !== candidateEntry) throw new Error("Routing AR did not resolve to the candidate")
if (realpathSync(Bun.resolveSync("@tscircuit/capacity-autorouter", helperRoot)) !== originalEntry) throw new Error("Assessment AR did not remain published")
const proof = { ...candidate.proof, originalEntry, candidateEntry, originalCoreEntry: core.entry, originalCoreSha256, helperProofPath, helperProofSha256, helperEntry: join(helperRoot, "index.js"), helperEntrySha256: helperEntry.outputSha256, publishedAutorouterPreserved: true, publishedCorePreserved: true, originalAssessmentPreparedFirst: true, assessmentAutorouterUnchanged: true, additionalObserverAdded: false }
autorouter.entry = candidateEntry
autorouter.entrySha256 = proof.outputSha256
manifest.sourceOverrides = true
manifest.experiment = "budget-sufficiency-diagnostic"
manifest.budgetDiagnostic = proof
manifest.dependencyOverrides = [{ name: "@tscircuit/capacity-autorouter", from: "published0.0.1107", to: "published0.0.1107-with-budget-sufficiency-diagnostic", reason: "Diagnostic only: test whether doubling the existing shared search allowance changes native completion" }]
for (const item of manifest.packageAliases ?? []) if (resolve(item.alias) === alias) item.target = candidateFolder
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(join(root, "budget-sufficiency-diagnostic-proof.json"), JSON.stringify(proof, null, 2) + "\n")
task.experiment = manifest.experiment
task.dependencyOverrides = manifest.dependencyOverrides
task.budgetDiagnostic = proof
task.routingSourceOverride = true
task.diagnosticOnly = true
writeFileSync(casePath, JSON.stringify(task, null, 2) + "\n")
console.log("BUDGET_SUFFICIENCY_DIAGNOSTIC_PROVENANCE " + JSON.stringify(proof))
