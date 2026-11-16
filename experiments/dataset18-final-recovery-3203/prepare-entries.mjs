import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const [rootArg, outputArg] = process.argv.slice(2)
if (!rootArg || !outputArg || Bun.version !== "1.4.3") throw new Error("Usage: Bun1.4.3 prepare-entries.mjs VERIFIED_RUNTIME_ROOT OUTPUT")
const root = resolve(rootArg), output = resolve(outputArg)
const manifest = JSON.parse(readFileSync(join(root, "runtime-manifest.json"), "utf8"))
const frozen = JSON.parse(readFileSync(join(import.meta.dir, "experiment.json"), "utf8"))
const hash = value => createHash("sha256").update(value).digest("hex")
if (!frozen.frozen || manifest.mainVersion !== "0.0.3203" || manifest.experiment !== "published" || manifest.sourceOverrides || manifest.dependencyOverrides.length) throw new Error("Expected untouched frozen3203 runtime")
assert.deepStrictEqual(new Set(manifest.packages.map(item => item.name)), new Set(Object.keys(frozen.runtime)))
for (const item of manifest.packages) {
  if (frozen.runtime[item.name] !== item.version || frozen.runtimeEntrySha256[item.name] !== item.entrySha256 || hash(readFileSync(item.entry)) !== item.entrySha256) throw new Error("Published runtime identity differs")
}
for (const alias of manifest.packageAliases) {
  if (realpathSync(alias.alias) !== realpathSync(alias.target)) throw new Error("Original published runtime alias changed")
}
const original = manifest.packages.find(item => item.name === "@tscircuit/capacity-autorouter")
const folder = join(root, "npm", "autorouter")
if (original.entrySha256 !== frozen.baseEntrySha256 || resolve(original.entry) !== join(folder, "dist", "index.js")) throw new Error("Expected exact published AR1109")
if (hash(readFileSync(join(import.meta.dir, "prepare-recovery-only.py"))) !== frozen.adapterSha256) throw new Error("Frozen adapter changed")
const byteProofPath = join(root, "dataset18-recovery-only-byte-proof.json")
if (existsSync(byteProofPath)) throw new Error("Refuse to replace an existing byte proof")
const prepared = spawnSync("python3", [join(import.meta.dir, "prepare-recovery-only.py"), original.entry, byteProofPath], { encoding: "utf8" })
if (prepared.error || prepared.status !== 0) throw new Error(`Exact held adapter failed: ${prepared.error?.message ?? prepared.stderr}`)
const byteProof = JSON.parse(readFileSync(byteProofPath, "utf8"))
const expected = JSON.parse(readFileSync(join(import.meta.dir, "candidate-byte-proof.json"), "utf8"))
// The frozen audit path is local preparation metadata, not a CI entry location.
assert.deepStrictEqual({ ...byteProof, inputEntry: expected.inputEntry }, expected)
const originalBytes = readFileSync(original.entry)
const originalSource = originalBytes.toString("utf8")
if (originalSource.split(byteProof.originalFactoryAnchor).length !== 2) throw new Error("Expected exactly one Prepared final factory")
const candidateBytes = Buffer.from(originalSource.replace(byteProof.originalFactoryAnchor, byteProof.replacementFactoryAnchor))
if (hash(candidateBytes) !== frozen.diagnosticEntrySha256 || candidateBytes.length !== byteProof.candidateBytes) throw new Error("Candidate differs from the frozen byte proof")
const differences = []
for (let index = 0; index < originalBytes.length; index++) if (originalBytes[index] !== candidateBytes[index]) differences.push(index)
assert.deepStrictEqual(differences, frozen.changedByteOffsets)
const candidateFolder = join(root, "npm", "autorouter-dataset18-final-recovery-diagnostic")
if (existsSync(candidateFolder)) throw new Error("Refuse to replace an existing candidate")
mkdirSync(candidateFolder)
const copyPackage = current => {
  for (const item of readdirSync(current, { withFileTypes: true })) {
    const source = join(current, item.name), target = join(candidateFolder, relative(folder, source))
    if (item.isSymbolicLink() && source === join(folder, "node_modules")) symlinkSync(realpathSync(source), target)
    else if (item.isDirectory()) { mkdirSync(target); copyPackage(source) }
    else if (item.isFile()) {
      if (source === original.entry) writeFileSync(target, candidateBytes)
      else linkSync(source, target)
    } else throw new Error("Unexpected published AR package entry")
  }
}
copyPackage(folder)
const candidateEntry = join(candidateFolder, "dist", "index.js")
if (hash(readFileSync(original.entry)) !== frozen.baseEntrySha256 || hash(readFileSync(candidateEntry)) !== frozen.diagnosticEntrySha256 || realpathSync(join(candidateFolder, "node_modules")) !== realpathSync(join(folder, "node_modules"))) throw new Error("Routing dependency graph or original entry changed")
const proof = { diagnosticOnly: true, productionFixProposed: false, preparationByteProof: byteProof,
  installation: { status: "private CI entry installed; imports and actual benchmark constructor probes follow in prepare-pair.py", fullCandidateEntryRetained: true, retainedInCiRuntime: true, routingPerformed: false, candidateImportPerformedByInstaller: false },
  base: { entry: original.entry, sha256: original.entrySha256, packageFolder: folder },
  pr: { entry: candidateEntry, sha256: byteProof.candidateSha256, packageFolder: candidateFolder },
  sharedRoutingDependencies: realpathSync(join(folder, "node_modules")),
  originalRuntimeManifestSha256: hash(readFileSync(join(root, "runtime-manifest.json"))),
  runtimeAliasesRetargeted: false, originalMainCoreAndAssessmentGraphUnchanged: true }
writeFileSync(output, JSON.stringify(proof, null, 2) + "\n")
console.log("DATASET18_ROUTING_ENTRY_PROOF " + JSON.stringify(proof))
