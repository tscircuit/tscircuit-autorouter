import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [rootArgument] = process.argv.slice(2)
assert(rootArgument, "Usage: prepare-stitch-candidate.ts VERIFIED_RUNTIME_ROOT")
assert.equal(Bun.version, "1.4.3")
const root = resolve(rootArgument)
const plan = JSON.parse(readFileSync(join(import.meta.dir, "stitch-candidate-plan.json"), "utf8"))
const runtimePath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(runtimePath, "utf8"))
const phasePath = join(root, "terminal-witness-runtime.json")
const phase = JSON.parse(readFileSync(phasePath, "utf8"))
const sha = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
assert.equal(manifest.sourceOverrides, false)
assert.deepEqual(manifest.dependencyOverrides, [])
const published = manifest.packages.find((item: Record<string, any>) => item.name === "@tscircuit/capacity-autorouter")
assert(published)
assert.equal(published.version, plan.publishedAutorouterVersion)
const original = readFileSync(published.entry, "utf8")
assert.equal(sha(original), plan.publishedEntrySha256)
assert.equal(original.split(plan.oldBlock).length - 1, 1)
assert.equal(original.split(plan.mathFunction).length - 1, 1)
assert(!original.includes("__icepiExistingJunctions") && !original.includes("__icepiOriginalHdRoutes"))
assert.equal(sha(plan.oldBlock), plan.oldBlockSha256)
assert.equal(sha(plan.newBlock), plan.newBlockSha256)
assert.equal(sha(plan.mathFunction), plan.mathFunctionSha256)
const helper = readFileSync(join(import.meta.dir, "splitDisconnectedRoutesAtIntersections.ts"), "utf8")
assert.equal(sha(helper), plan.helperSourceSha256)
const transpiled = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(helper)
const importLine = 'import { getSegmentIntersection } from "@tscircuit/math-utils";\n'
assert.equal(transpiled.split(importLine).length - 1, 1)
assert.equal((transpiled.match(/\bexport\b/g) ?? []).length, 1)
const body = transpiled.replace(importLine, "").replace("export function splitDisconnectedRoutesAtIntersections", "function splitDisconnectedRoutesAtIntersections")
assert(!/\b(?:import|export)\b/.test(body))
const prefix = `const __icepiExistingJunctions=(()=>{\nconst getSegmentIntersection=ge;\n${body}\nreturn splitDisconnectedRoutesAtIntersections;\n})();\n`
assert.equal(sha(prefix), plan.prefixSha256)
const candidate = prefix + original.replace(plan.oldBlock, plan.newBlock)
assert.equal(sha(candidate), plan.candidateEntrySha256)
assert.equal(candidate.slice(prefix.length).replace(plan.newBlock, plan.oldBlock), original)

const packageRoot = join(root, "npm/autorouter")
const candidateRoot = join(root, "npm/autorouter-existing-junctions")
assert(!existsSync(candidateRoot), "Refuse to overwrite an existing candidate package")
mkdirSync(candidateRoot)
for (const file of published.publishedFiles) {
  const source = join(packageRoot, file.path)
  assert.equal(sha(readFileSync(source)), file.sha256)
  const target = join(candidateRoot, file.path)
  mkdirSync(resolve(target, ".."), { recursive: true })
  if (file.path === published.entryRelative) writeFileSync(target, candidate)
  else linkSync(source, target)
}
symlinkSync(realpathSync(join(packageRoot, "node_modules")), join(candidateRoot, "node_modules"))
const candidateEntry = join(candidateRoot, published.entryRelative)
const override = {
  name: published.name, kind: "source", version: published.version,
  description: "Expose exact existing same-layer copper crossings to the existing route stitcher",
  originalEntrySha256: plan.publishedEntrySha256, candidateEntrySha256: plan.candidateEntrySha256,
  helperSourceSha256: plan.helperSourceSha256, multipleSourceSha256: plan.multipleSourceSha256,
  oldBlockSha256: plan.oldBlockSha256, newBlockSha256: plan.newBlockSha256,
  prefixSha256: plan.prefixSha256, otherPublishedEntryBytesUnchanged: true,
}
copyFileSync(runtimePath, join(root, "published-runtime-manifest.json"))
copyFileSync(phasePath, join(root, "published-terminal-witness-runtime.json"))
const alias = join(root, "runtime/node_modules", published.name)
assert.equal(realpathSync(alias), packageRoot)
unlinkSync(alias)
symlinkSync(candidateRoot, alias)
const candidateIdentity = {
  ...published, entry: candidateEntry, entrySha256: plan.candidateEntrySha256,
  publishedEntry: published.entry, publishedEntrySha256: plan.publishedEntrySha256,
  publishedFiles: published.publishedFiles.map((file: Record<string, any>) => file.path === published.entryRelative
    ? { ...file, bytes: Buffer.byteLength(candidate), sha256: plan.candidateEntrySha256, publishedSha256: file.sha256 }
    : file),
}
const candidateManifest = {
  ...manifest, sourceOverrides: true, experiment: "existing-planar-junctions", dependencyOverrides: [override],
  packages: manifest.packages.map((item: Record<string, any>) => item === published ? candidateIdentity : item),
  packageAliases: manifest.packageAliases.map((item: Record<string, any>) => item.alias === alias ? { ...item, target: candidateRoot, publishedTarget: packageRoot } : item),
}
writeFileSync(runtimePath, JSON.stringify(candidateManifest, null, 2) + "\n")
writeFileSync(phasePath, JSON.stringify({
  ...phase, variant: "existing-planar-junctions", sourceOverrides: [override],
  autorouterEntry: candidateEntry, autorouterSha256: plan.candidateEntrySha256,
  originalAutorouterSha256: plan.publishedEntrySha256,
  packages: candidateManifest.packages.map(({ name, version, entrySha256 }: Record<string, any>) => ({ name, version, entrySha256 })),
  allNetPacketLimitBytes: plan.limits.allNetPacketBytes,
  expectedCoarseDiagnosticSha256: plan.baselineCoarseDiagnosticSha256,
}, null, 2) + "\n")
writeFileSync(join(root, "stitch-overlay-proof.json"), JSON.stringify({
  ...override, mathFunctionSha256: plan.mathFunctionSha256, mathSource: plan.mathSource,
  originalBlockCount: 1, mathFunctionCount: 1, dependencyGraphUnchanged: true,
  candidateEntry, publishedEntry: published.entry, originalBytes: Buffer.byteLength(original),
  candidateBytes: Buffer.byteLength(candidate), originalPackageUnmodified: sha(readFileSync(published.entry)) === plan.publishedEntrySha256,
}, null, 2) + "\n")
console.log(JSON.stringify({ candidatePrepared: true, override }))
