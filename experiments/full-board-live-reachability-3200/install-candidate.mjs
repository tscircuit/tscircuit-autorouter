import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { applyLiveReachabilityCandidate, ORIGINAL_AUTOROUTER_SHA256 } from "./apply-live-reachability-candidate.mjs"

const [rootArg] = process.argv.slice(2)
if (!rootArg) throw new Error("Usage: install-candidate.mjs VERIFIED_RUNTIME_ROOT")
const root = resolve(rootArg)
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.mainVersion !== "0.0.3200" || manifest.sourceOverrides || manifest.liveReachabilityCandidate || (manifest.dependencyOverrides?.length ?? 0) !== 0) throw new Error("Expected a fresh exact published3200 runtime")
const autorouter = manifest.packages.find(item => item.name === "@tscircuit/capacity-autorouter")
const core = manifest.packages.find(item => item.name === "@tscircuit/core")
if (autorouter?.version !== "0.0.1107" || autorouter.entrySha256 !== ORIGINAL_AUTOROUTER_SHA256 || core?.version !== "0.0.2395") throw new Error("Expected frozen published AR1107 and Core2395")
const originalFolder = join(root, "npm", "autorouter")
if (resolve(autorouter.entry) !== join(originalFolder, autorouter.entryRelative)) throw new Error("Unexpected original AR location")
const casePath = join(root, "cases", "glider-spaced.json")
const task = JSON.parse(readFileSync(casePath, "utf8"))
if (task.id !== "glider" || task.cohort !== "spaced" || task.captureDeadlineMs !== 900000 || task.hardDeadlineMs !== 960000 || task.assessmentDeadlineMs !== 180000) throw new Error("Unexpected native candidate case or budget")
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
const candidate = applyLiveReachabilityCandidate(readFileSync(originalEntry, "utf8"))
const frozenProof = JSON.parse(readFileSync(join(import.meta.dir, "candidate-proof.json"), "utf8"))
if (frozenProof.frozen !== true || candidate.proof.outputSha256 !== frozenProof.outputSha256) throw new Error("Candidate differs from reviewed frozen source")
const candidateFolder = join(root, "npm", "autorouter-live-reachability-candidate")
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
manifest.experiment = "live-reachability-candidate"
manifest.liveReachabilityCandidate = proof
manifest.dependencyOverrides = [{ name: "@tscircuit/capacity-autorouter", from: "published0.0.1107", to: "published0.0.1107-with-live-reachability-candidate", reason: "Detect a disconnected current assignment before search and invoke existing recovery" }]
for (const item of manifest.packageAliases ?? []) if (resolve(item.alias) === alias) item.target = candidateFolder
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(join(root, "live-reachability-candidate-proof.json"), JSON.stringify(proof, null, 2) + "\n")
task.experiment = manifest.experiment
task.dependencyOverrides = manifest.dependencyOverrides
task.liveReachabilityCandidate = proof
task.routingSourceOverride = true
writeFileSync(casePath, JSON.stringify(task, null, 2) + "\n")
console.log("LIVE_REACHABILITY_CANDIDATE_PROVENANCE " + JSON.stringify(proof))
