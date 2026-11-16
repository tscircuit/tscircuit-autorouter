import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const [rootArg, board] = process.argv.slice(2)
if (!rootArg || !["glider", "imx6"].includes(board)) throw new Error("Usage: install-diagnostic.mjs VERIFIED_RUNTIME_ROOT glider|imx6")
const root = resolve(rootArg)
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const frozen = JSON.parse(readFileSync(join(import.meta.dir, "candidate-byte-proof.json"), "utf8"))
if (manifest.mainVersion !== "0.0.3203" || manifest.experiment !== "published" || manifest.sourceOverrides || manifest.recoveryDiagnostic || (manifest.dependencyOverrides?.length ?? 0) !== 0) throw new Error("Expected a fresh exact published3203 runtime")
const autorouter = manifest.packages.find(item => item.name === "@tscircuit/capacity-autorouter")
const core = manifest.packages.find(item => item.name === "@tscircuit/core")
if (autorouter?.version !== "0.0.1109" || autorouter.entrySha256 !== frozen.inputSha256 || core?.version !== "0.0.2396") throw new Error("Expected frozen published AR1109 and Core2396")
const originalFolder = join(root, "npm", "autorouter")
if (resolve(autorouter.entry) !== join(originalFolder, autorouter.entryRelative)) throw new Error("Unexpected original AR location")
const originalEntry = autorouter.entry
const casePath = join(root, "cases", `${board}-spaced.json`)
const task = JSON.parse(readFileSync(casePath, "utf8"))
if (task.id !== board || task.cohort !== "spaced" || task.captureDeadlineMs !== 900000 || task.hardDeadlineMs !== 960000 || task.assessmentDeadlineMs !== 180000) throw new Error("Unexpected default-window recovery case or deadlines")
const sha = bytes => createHash("sha256").update(bytes).digest("hex")
const byteProofPath = join(root, "recovery-only-byte-proof.json")
if (existsSync(byteProofPath)) throw new Error("Refuse to replace an existing byte proof")
const prepared = spawnSync("python3", [join(import.meta.dir, "prepare-recovery-only.py"), originalEntry, byteProofPath], { encoding: "utf8" })
if (prepared.error || prepared.status !== 0) throw new Error(`Exact held adapter failed: ${prepared.error?.message ?? prepared.stderr}`)
const byteProof = JSON.parse(readFileSync(byteProofPath, "utf8"))
for (const key of ["inputSha256", "candidateSha256", "inputBytes", "candidateBytes", "originalFactoryAnchor", "replacementFactoryAnchor", "mainCapAnchor"]) {
  if (byteProof[key] !== frozen[key]) throw new Error(`Held byte proof changed: ${key}`)
}
if (JSON.stringify(byteProof.changedByteOffsets) !== JSON.stringify(frozen.changedByteOffsets)) throw new Error("Changed byte offset differs from review")
const originalBytes = readFileSync(originalEntry)
const originalSource = originalBytes.toString("utf8")
if (originalSource.split(byteProof.originalFactoryAnchor).length !== 2) throw new Error("Expected exactly one Prepared final factory")
const candidateBytes = Buffer.from(originalSource.replace(byteProof.originalFactoryAnchor, byteProof.replacementFactoryAnchor))
if (sha(candidateBytes) !== frozen.candidateSha256 || candidateBytes.length !== frozen.candidateBytes) throw new Error("Candidate does not match the held byte proof")
const differences = []
for (let index = 0; index < originalBytes.length; index++) if (originalBytes[index] !== candidateBytes[index]) differences.push(index)
if (JSON.stringify(differences) !== JSON.stringify(frozen.changedByteOffsets)) throw new Error("Candidate differs outside the one reviewed byte")
const helperProofPath = join(root, "cases", "assessment-helper-proof.json")
const helperProof = JSON.parse(readFileSync(helperProofPath, "utf8"))
const helperEntry = helperProof.files.find(file => file.name === "index.js")
if (helperProof.coreIdentity?.entrySha256 !== core.entrySha256 || helperEntry?.originalSha256 !== core.entrySha256 || !helperEntry.prefixExact) throw new Error("Original assessment adapter must precede diagnostic installation")
const helperRoot = join(root, "cases", "assessment-core")
if (sha(readFileSync(join(helperRoot, "index.js"))) !== helperEntry.outputSha256) throw new Error("Assessment adapter bytes do not match their proof")
const helperProofSha256 = sha(readFileSync(helperProofPath))
const originalCoreSha256 = sha(readFileSync(core.entry))
if (originalCoreSha256 !== core.entrySha256) throw new Error("Original Core identity mismatch")
const candidateFolder = join(root, "npm", "autorouter-final-recovery-diagnostic")
if (existsSync(candidateFolder)) throw new Error("Refuse to replace an existing candidate package")
mkdirSync(candidateFolder)
const copyPackage = folder => {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const source = join(folder, item.name), target = join(candidateFolder, relative(originalFolder, source))
    if (item.isSymbolicLink() && source === join(originalFolder, "node_modules")) symlinkSync(realpathSync(source), target)
    else if (item.isDirectory()) { mkdirSync(target); copyPackage(source) }
    else if (item.isFile()) {
      if (source === originalEntry) writeFileSync(target, candidateBytes)
      else linkSync(source, target)
    } else throw new Error("Unexpected published AR package entry")
  }
}
copyPackage(originalFolder)
const candidateEntry = join(candidateFolder, autorouter.entryRelative)
// Import only, in separate processes; no solver is instantiated or stepped.
const importProbe = `import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; import { pathToFileURL } from 'node:url'; const path=process.argv[1]; const value=await import(pathToFileURL(path).href); console.log(JSON.stringify({sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),exports:Object.keys(value).sort(),pipeline9:typeof value.AutoroutingPipelineSolver9_PreloadedTraceGraph==='function'}))`
const imports = []
for (const entry of [originalEntry, candidateEntry]) {
  const result = spawnSync(process.execPath, ["--eval", importProbe, entry], { encoding: "utf8", cwd: join(root, "runtime") })
  if (result.error || result.status !== 0) throw new Error(`AR import probe failed: ${result.error?.message ?? result.stderr}`)
  imports.push(JSON.parse(result.stdout.trim()))
}
if (imports[0].sha256 !== frozen.inputSha256 || imports[1].sha256 !== frozen.candidateSha256 || !imports.every(item => item.pipeline9) || JSON.stringify(imports[0].exports) !== JSON.stringify(imports[1].exports)) throw new Error("Original/candidate import identities or exports differ")
const alias = join(root, "runtime", "node_modules", "@tscircuit", "capacity-autorouter")
if (realpathSync(alias) !== originalFolder) throw new Error("Unexpected original AR alias")
// The assessment-only neutral Core keeps the original published AR dependency.
const helperScope = join(helperRoot, "node_modules", "@tscircuit")
mkdirSync(helperScope, { recursive: true })
symlinkSync(originalFolder, join(helperScope, "capacity-autorouter"))
unlinkSync(alias)
symlinkSync(candidateFolder, alias)
if (sha(readFileSync(originalEntry)) !== frozen.inputSha256 || sha(readFileSync(core.entry)) !== originalCoreSha256 || sha(readFileSync(helperProofPath)) !== helperProofSha256) throw new Error("Original packages or assessment proof changed")
if (realpathSync(Bun.resolveSync("@tscircuit/capacity-autorouter", join(root, "runtime"))) !== candidateEntry) throw new Error("Routing AR did not resolve to the diagnostic")
if (realpathSync(Bun.resolveSync("@tscircuit/capacity-autorouter", helperRoot)) !== originalEntry) throw new Error("Assessment AR did not remain published")
const proof = { ...byteProof, status: "installed diagnostic; import-only probes passed; no routing performed by installer", fullCandidateEntryRetained: true, retainedInCiRuntime: true, byteProofScope: "Copied frozen byte proof describes in-memory preparation; this proof describes the private CI entry after installation/import", outputSha256: byteProof.candidateSha256, originalEntry, candidateEntry, originalCoreEntry: core.entry, originalCoreSha256, helperProofPath, helperProofSha256, helperEntry: join(helperRoot, "index.js"), helperEntrySha256: helperEntry.outputSha256, publishedAutorouterPreserved: true, publishedCorePreserved: true, originalAssessmentPreparedFirst: true, assessmentAutorouterUnchanged: true, additionalObserverAdded: false, importProbe: { separateProcesses: true, exportCount: imports[0].exports.length, exportsIdentical: true, pipeline9ExportAvailable: true, noSolverConstructedOrStepped: true } }
autorouter.entry = candidateEntry
autorouter.entrySha256 = proof.outputSha256
manifest.sourceOverrides = true
manifest.experiment = "final-recovery-only-diagnostic"
manifest.recoveryDiagnostic = proof
manifest.dependencyOverrides = [{ name: "@tscircuit/capacity-autorouter", from: "published0.0.1109", to: "published0.0.1109-with-final-recovery-only-diagnostic", reason: "Diagnostic only: Prepared conditional final child multiplier2→4; main2M retained" }]
for (const item of manifest.packageAliases ?? []) if (resolve(item.alias) === alias) item.target = candidateFolder
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(join(root, "final-recovery-only-diagnostic-proof.json"), JSON.stringify(proof, null, 2) + "\n")
task.experiment = manifest.experiment
task.dependencyOverrides = manifest.dependencyOverrides
task.recoveryDiagnostic = proof
task.routingSourceOverride = true
task.diagnosticOnly = true
writeFileSync(casePath, JSON.stringify(task, null, 2) + "\n")
console.log("FINAL_RECOVERY_ONLY_DIAGNOSTIC_PROVENANCE " + JSON.stringify(proof))
