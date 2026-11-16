import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { applyCombinedCandidate } from "./apply-combined-candidate.mjs"

const [rootArg] = process.argv.slice(2)
if (!rootArg) throw new Error("Usage: install-candidate.mjs VERIFIED_RUNTIME_ROOT")
const root = resolve(rootArg)
const experiment = JSON.parse(readFileSync(join(import.meta.dir, "experiment.json"), "utf8"))
if (!experiment.frozen) throw new Error("Combined candidate must be frozen before installation")
const sha = value => createHash("sha256").update(value).digest("hex")
for (const [file, expected] of Object.entries(experiment.engines))
  if (sha(readFileSync(join(import.meta.dir, file))) !== expected) throw new Error(`Immutable patch engine changed: ${file}`)
const regions = JSON.parse(readFileSync(join(import.meta.dir, "candidate-regions.json"), "utf8"))
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.mainVersion !== experiment.runtime.main || manifest.sourceOverrides || (manifest.dependencyOverrides?.length ?? 0) !== 0)
  throw new Error("Expected a fresh exact published runtime")
const core = manifest.packages.find(item => item.name === "@tscircuit/core")
if (core?.version !== experiment.runtime.core || core.entrySha256 !== experiment.originalCoreSha256)
  throw new Error("Expected the frozen published Core")
const originalFolder = join(root, "npm", "core")
if (resolve(core.entry) !== join(originalFolder, core.entryRelative)) throw new Error("Unexpected original Core location")
const casePath = join(root, "cases", "h616-original.json")
const task = JSON.parse(readFileSync(casePath, "utf8"))
if (task.id !== "h616" || task.cohort !== "original" || task.captureDeadlineMs !== 900000 || task.hardDeadlineMs !== 960000 || task.assessmentDeadlineMs !== 180000)
  throw new Error("Unexpected authentic case or routing budget")
const helperProofPath = join(root, "cases", "assessment-helper-proof.json")
const helperProof = JSON.parse(readFileSync(helperProofPath, "utf8"))
const helperEntry = helperProof.files.find(file => file.name === "index.js")
if (helperProof.coreIdentity?.entrySha256 !== experiment.originalCoreSha256 || helperEntry?.originalSha256 !== experiment.originalCoreSha256 || !helperEntry.prefixExact)
  throw new Error("Prepare the unmodified published-Core assessment helper first")
if (sha(readFileSync(join(root, "cases", "assessment-core", "index.js"))) !== helperEntry.outputSha256)
  throw new Error("Original assessment adapter differs from its proof")
const helperProofSha256 = sha(readFileSync(helperProofPath))
const originalEntry = core.entry
const candidate = applyCombinedCandidate(readFileSync(originalEntry, "utf8"), { experiment, regions })
const candidateFolder = join(root, "npm", "core-antipad-pad-edge-candidate")
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
if (sha(readFileSync(originalEntry)) !== experiment.originalCoreSha256 || sha(readFileSync(helperProofPath)) !== helperProofSha256)
  throw new Error("Original Core or assessment proof changed")
if (realpathSync(Bun.resolveSync("@tscircuit/core", join(root, "runtime"))) !== candidateEntry)
  throw new Error("Candidate Core alias did not resolve to the private copy")
const proof = { ...candidate.proof, originalEntry, candidateEntry, helperProofSha256,
  publishedCorePreserved: true, originalAssessmentPreparedFirst: true }
core.entry = candidateEntry
core.entrySha256 = proof.outputSha256
manifest.sourceOverrides = true
manifest.experiment = experiment.experiment
manifest.coreCombinedCandidate = proof
manifest.dependencyOverrides = [{ name: "@tscircuit/core", from: `published${core.version}`,
  to: `published${core.version}-with-antipad-and-pad-edge-diagnostic`,
  reason: "Joint hypothesis: intermediate via antipads and enumeration of existing pad-edge retry alternatives" }]
for (const item of manifest.packageAliases ?? []) if (item.name === "@tscircuit/core") item.target = candidateFolder
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(join(root, "combined-candidate-proof.json"), JSON.stringify(proof, null, 2) + "\n")
task.experiment = manifest.experiment
task.dependencyOverrides = manifest.dependencyOverrides
task.coreCombinedCandidate = proof
task.routingSourceOverride = true
writeFileSync(casePath, JSON.stringify(task, null, 2) + "\n")
console.log("COMBINED_CANDIDATE_PROVENANCE " + JSON.stringify(proof))
console.log("JOINT_HYPOTHESIS_NOTE This experiment combines two changes and cannot attribute benefit to either alone.")
