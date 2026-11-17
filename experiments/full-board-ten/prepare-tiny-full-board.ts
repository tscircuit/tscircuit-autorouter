import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

type RuntimeObject = Record<string, any>

const [rootArgument] = process.argv.slice(2)
assert(rootArgument, "Expected VERIFIED_RUNTIME_ROOT")
const root = resolve(rootArgument)
const validation = JSON.parse(readFileSync(join(root, "native-phase/candidate/validation.json"), "utf8"))
assert.equal(validation.valid, true)
assert.equal(validation.checks.entire_native_phase_solved, true)
const proofPath = join(root, "source-pair/provenance.json")
const proof = JSON.parse(readFileSync(proofPath, "utf8"))
assert.equal(proof.passed, true)
assert.equal(proof.nonTinySourceBodiesIdentical, true)
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
assert.equal(manifest.sourceOverrides, false)
assert.deepEqual(manifest.dependencyOverrides, [])
const published = manifest.packages.find((item: RuntimeObject) => item.label === "autorouter")
assert(published)
const sha = (bytes: Buffer): string => createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
const entry = readFileSync(proof.entries.candidate.path)
assert.equal(sha(entry), proof.entries.candidate.sha256)
const packageRoot = join(root, "npm/autorouter")
const candidateRoot = join(root, "npm/autorouter-tiny-segment-reuse")
assert(!existsSync(candidateRoot))
mkdirSync(candidateRoot)
for (const file of published.publishedFiles) {
  const source = join(packageRoot, file.path)
  assert.equal(sha(readFileSync(source)), file.sha256)
  const destination = join(candidateRoot, file.path)
  mkdirSync(dirname(destination), { recursive: true })
  if (file.path === published.entryRelative) writeFileSync(destination, new Uint8Array(entry))
  else if (file.path === `${published.entryRelative}.map`) copyFileSync(`${proof.entries.candidate.path}.map`, destination)
  else linkSync(source, destination)
}
symlinkSync(realpathSync(join(packageRoot, "node_modules")), join(candidateRoot, "node_modules"))
const alias = join(root, "runtime/node_modules", published.name)
assert.equal(realpathSync(alias), packageRoot)
unlinkSync(alias)
symlinkSync(candidateRoot, alias)
copyFileSync(manifestPath, join(root, "published-runtime-manifest.json"))
const override = {
  name: published.name, kind: "source", version: published.version,
  description: "Reuse capacity for an identical committed same-net Tiny segment",
  originalEntrySha256: published.entrySha256, candidateEntrySha256: proof.entries.candidate.sha256,
  sourceProofSha256: sha(readFileSync(proofPath)), productionPatchSha256: proof.productionPatchSha256,
  nonTinySourceBodiesIdentical: true, runtimeDependenciesUnchanged: true,
  runtimeOverrideKind: "whole package entry replacement; no solver injection",
}
const candidateIdentity = {
  ...published, entry: join(candidateRoot, published.entryRelative), entrySha256: proof.entries.candidate.sha256,
  publishedEntry: published.entry, publishedEntrySha256: published.entrySha256,
  publishedFiles: published.publishedFiles.map((file: RuntimeObject) => {
    if (![published.entryRelative, `${published.entryRelative}.map`].includes(file.path)) return file
    const bytes = readFileSync(join(candidateRoot, file.path))
    return { ...file, bytes: bytes.length, sha256: sha(bytes), publishedSha256: file.sha256 }
  }),
}
const candidateManifest = {
  ...manifest, sourceOverrides: true, experiment: "tiny-exact-segment-reuse", dependencyOverrides: [override],
  packages: manifest.packages.map((item: RuntimeObject) => item === published ? candidateIdentity : item),
  packageAliases: manifest.packageAliases.map((item: RuntimeObject) => item.alias === alias ? { ...item, target: candidateRoot, publishedTarget: packageRoot } : item),
}
writeFileSync(manifestPath, JSON.stringify(candidateManifest, null, 2) + "\n")
writeFileSync(join(root, "tiny-full-board-overlay-proof.json"), JSON.stringify({ ...override, candidateEntry: candidateIdentity.entry, originalPackageUnmodified: sha(readFileSync(published.entry)) === published.entrySha256 }, null, 2) + "\n")
console.log(JSON.stringify({ preparedFullBoardCandidate: true, override }))
