import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { applyPadEdgeCandidate, ORIGINAL_CORE_SHA256 } from "./apply-pad-edge-candidate.mjs"

const [rootArg] = process.argv.slice(2)
if (!rootArg) throw new Error("Usage: install-candidate.mjs VERIFIED_RUNTIME_ROOT")
const root = resolve(rootArg)
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.mainVersion !== "0.0.3199" || manifest.sourceOverrides || manifest.corePadEdgeCandidate || (manifest.dependencyOverrides?.length ?? 0) !== 0) throw new Error("Expected a fresh exact published3199 runtime")
const core = manifest.packages.find(item => item.name === "@tscircuit/core")
if (core?.version !== "0.0.2394" || core.entrySha256 !== ORIGINAL_CORE_SHA256) throw new Error("Expected frozen published Core2394")
const originalFolder = join(root, "npm", "core")
if (resolve(core.entry) !== join(originalFolder, core.entryRelative)) throw new Error("Unexpected original Core location")
const casePath = join(root, "cases", "butterstick-spaced.json")
const task = JSON.parse(readFileSync(casePath, "utf8"))
if (task.id !== "butterstick" || task.cohort !== "spaced" || task.captureDeadlineMs !== 900000 || task.hardDeadlineMs !== 960000 || task.assessmentDeadlineMs !== 180000) throw new Error("Unexpected native candidate case or budget")
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const helperProofPath = join(root, "cases", "assessment-helper-proof.json")
const helperProof = JSON.parse(readFileSync(helperProofPath, "utf8"))
const helperEntry = helperProof.files.find(file => file.name === "index.js")
if (helperProof.coreIdentity?.entrySha256 !== ORIGINAL_CORE_SHA256 || helperEntry?.originalSha256 !== ORIGINAL_CORE_SHA256 || !helperEntry.prefixExact) throw new Error("Original assessment adapter must be prepared before installing the candidate")
if (sha(readFileSync(join(root, "cases", "assessment-core", "index.js"))) !== helperEntry.outputSha256) throw new Error("Original assessment adapter bytes do not match their proof")
const helperProofSha256 = sha(readFileSync(helperProofPath))
const originalEntry = core.entry
const candidate = applyPadEdgeCandidate(readFileSync(originalEntry, "utf8"))
const frozenProof = JSON.parse(readFileSync(join(import.meta.dir, "candidate-proof.json"), "utf8"))
if (candidate.proof.outputSha256 !== frozenProof.outputSha256) throw new Error("Pad-edge candidate differs from the reviewed bytes")
const candidateFolder = join(root, "npm", "core-pad-edge-candidate")
if (existsSync(candidateFolder)) throw new Error("Refuse to replace an existing candidate package")
mkdirSync(candidateFolder)
const copyPackage = folder => {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const source = join(folder, item.name), target = join(candidateFolder, relative(originalFolder, source))
    if (item.isDirectory()) { mkdirSync(target); copyPackage(source) }
    else if (item.isFile()) {
      if (source === originalEntry) writeFileSync(target, candidate.source)
      else linkSync(source, target)
    } else throw new Error("Unexpected nonregular published Core package file")
  }
}
copyPackage(originalFolder)
const candidateEntry = join(candidateFolder, core.entryRelative)
const alias = join(root, "runtime", "node_modules", "@tscircuit", "core")
if (realpathSync(alias) !== originalFolder) throw new Error("Unexpected original Core alias")
unlinkSync(alias)
symlinkSync(candidateFolder, alias)
if (sha(readFileSync(originalEntry)) !== ORIGINAL_CORE_SHA256 || sha(readFileSync(helperProofPath)) !== helperProofSha256) throw new Error("Original Core or assessment proof changed")
if (realpathSync(Bun.resolveSync("@tscircuit/core", join(root, "runtime"))) !== candidateEntry) throw new Error("Candidate Core alias did not resolve to the private copy")
const proof = { ...candidate.proof, originalEntry, candidateEntry, helperProofSha256, publishedCorePreserved: true, originalAssessmentPreparedFirst: true, busObserverAdded: false }
core.entry = candidateEntry
core.entrySha256 = proof.outputSha256
manifest.sourceOverrides = true
manifest.experiment = "pad-edge-site-candidate"
manifest.corePadEdgeCandidate = proof
manifest.dependencyOverrides = [{ name: "@tscircuit/core", from: "published0.0.2394", to: "published0.0.2394-with-pad-edge-site-candidate", reason: "Let the existing explicit pad-edge retry inspect its appended alternatives before joint compatibility" }]
for (const item of manifest.packageAliases ?? []) if (item.name === "@tscircuit/core") item.target = candidateFolder
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(join(root, "pad-edge-candidate-proof.json"), JSON.stringify(proof, null, 2) + "\n")
task.experiment = manifest.experiment
task.dependencyOverrides = manifest.dependencyOverrides
task.corePadEdgeCandidate = proof
task.routingSourceOverride = true
writeFileSync(casePath, JSON.stringify(task, null, 2) + "\n")
console.log("PAD_EDGE_CANDIDATE_PROVENANCE " + JSON.stringify(proof))
