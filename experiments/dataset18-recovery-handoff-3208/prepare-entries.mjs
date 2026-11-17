import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"

const [rootArg, outputArg] = process.argv.slice(2)
assert(rootArg && outputArg && Bun.version === "1.4.3", "Usage: Bun1.4.3 prepare-entries.mjs VERIFIED_RUNTIME_ROOT OUTPUT")
const root = resolve(rootArg)
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const frozen = JSON.parse(readFileSync(join(import.meta.dir, "experiment.json"), "utf8"))
const bundlesFolder = join(import.meta.dir, "../full-board-ten/source-bundles")
const bundleManifestPath = join(bundlesFolder, "manifest.json")
const bundles = JSON.parse(readFileSync(bundleManifestPath, "utf8"))
assert(frozen.frozen && manifest.mainVersion === "0.0.3208" && !manifest.sourceOverrides && !manifest.dependencyOverrides.length)
assert.equal(frozen.routingSource.autorouterVersion, "0.0.1113")
assert.equal(frozen.routingSource.mainPackageRun, false)
assert.equal(bundles.autorouterGitHead, frozen.routingSource.autorouterCommit)
assert.deepStrictEqual(new Set(manifest.packages.map((item) => item.name)), new Set(Object.keys(frozen.runtime)))
for (const item of manifest.packages) {
  assert.equal(item.version, frozen.runtime[item.name])
  assert.equal(item.entrySha256, frozen.runtimeEntrySha256[item.name])
  assert.equal(hash(readFileSync(item.entry)), item.entrySha256)
}
for (const alias of manifest.packageAliases) assert.equal(realpathSync(alias.alias), realpathSync(alias.target))
const original = manifest.packages.find((item) => item.name === "@tscircuit/capacity-autorouter")
assert.equal(original.entrySha256, bundles.originalAutorouterSHA256)
const originalFolder = join(root, "npm", "autorouter")
assert.equal(resolve(original.entry), join(originalFolder, "dist", "index.js"))
for (const file of original.publishedFiles) {
  assert(!file.path.startsWith("/") && !file.path.split("/").includes(".."))
  assert.equal(hash(readFileSync(join(originalFolder, file.path))), file.sha256)
}
const sharedDependencies = realpathSync(join(originalFolder, "node_modules"))
const published = await import(pathToFileURL(original.entry).href)
const proof = {
  diagnosticOnly: true,
  routingSourceOverride: true,
  productionFixProposed: false,
  routingSource: frozen.routingSource,
  originalPublishedAutorouterVersion: original.version,
  publishedSourceReference: frozen.publishedSourceReference,
  sourceBundleManifestSha256: hash(readFileSync(bundleManifestPath)),
  sourcePatchSha256: frozen.sourcePatchSha256,
  sharedRoutingDependencies: sharedDependencies,
  originalRuntimeManifestSha256: hash(readFileSync(manifestPath)),
  runtimeAliasesRetargeted: false,
  originalMainCoreAndAssessmentGraphUnchanged: true,
  installation: { routingPerformed: false, sourceModulesImported: true },
}
for (const [lane, variant] of [["base", "source-baseline"], ["pr", "handoff-only"]]) {
  const selected = bundles.variants[variant]
  const compressed = readFileSync(join(bundlesFolder, selected.filename))
  assert.equal(compressed.length, selected.compressedBytes)
  assert.equal(hash(compressed), selected.compressedSha256)
  const source = gunzipSync(compressed)
  assert.equal(source.length, selected.entryBytes)
  assert.equal(hash(source), selected.entrySha256)
  assert.equal(selected.entrySha256, frozen.sourceEntrySha256[lane])
  const packageFolder = join(root, "npm", `autorouter-dataset18-${lane}`)
  assert(!existsSync(packageFolder), "Refuse to replace an existing private package")
  mkdirSync(packageFolder)
  const copyPackage = (folder) => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const sourcePath = join(folder, item.name)
      const destination = join(packageFolder, relative(originalFolder, sourcePath))
      if (item.isSymbolicLink() && sourcePath === join(originalFolder, "node_modules")) {
        symlinkSync(sharedDependencies, destination)
      } else if (item.isDirectory()) {
        mkdirSync(destination)
        copyPackage(sourcePath)
      } else if (item.isFile()) {
        if (sourcePath !== original.entry) linkSync(sourcePath, destination)
      } else throw new Error("Unexpected published package entry")
    }
  }
  copyPackage(originalFolder)
  const entry = join(packageFolder, "dist", "index.js")
  const sourceFolder = join(dirname(entry), "source-pipeline9")
  mkdirSync(sourceFolder)
  const sourceEntry = join(sourceFolder, "index.js")
  writeFileSync(sourceEntry, source)
  const runtimeOriginal = realpathSync(join(sharedDependencies, "@tscircuit/solver-utils"))
  const runtimePrivate = join(sourceFolder, "node_modules/@tscircuit/solver-utils")
  mkdirSync(runtimePrivate, { recursive: true })
  const runtimeMetadata = JSON.parse(readFileSync(join(runtimeOriginal, "package.json"), "utf8"))
  assert.equal(runtimeMetadata.name, "@tscircuit/solver-utils")
  assert.equal(runtimeMetadata.version, "0.0.23")
  const runtimeFiles = []
  const copyRuntime = (folder) => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const originalPath = join(folder, item.name)
      const relativePath = relative(runtimeOriginal, originalPath)
      const target = join(runtimePrivate, relativePath)
      if (item.isDirectory()) { mkdirSync(target); copyRuntime(originalPath) }
      else if (item.isFile()) {
        linkSync(originalPath, target)
        const sha256 = hash(readFileSync(originalPath))
        assert.equal(hash(readFileSync(target)), sha256)
        runtimeFiles.push({ path: relativePath, sha256 })
      } else throw new Error("Unexpected solver-utils package entry")
    }
  }
  copyRuntime(runtimeOriginal)
  const privateRuntimeEntry = realpathSync(Bun.resolveSync("@tscircuit/solver-utils", sourceFolder))
  const originalRuntimeEntry = realpathSync(Bun.resolveSync("@tscircuit/solver-utils", dirname(original.entry)))
  assert.equal(privateRuntimeEntry, realpathSync(join(runtimePrivate, "dist/index.js")))
  assert.equal(originalRuntimeEntry, realpathSync(join(runtimeOriginal, "dist/index.js")))
  assert.notEqual(privateRuntimeEntry, originalRuntimeEntry)
  assert.equal(realpathSync(Bun.resolveSync("graphics-debug", dirname(privateRuntimeEntry))), realpathSync(Bun.resolveSync("graphics-debug", dirname(originalRuntimeEntry))))
  assert.equal(realpathSync(Bun.resolveSync("object-hash", sourceFolder)), realpathSync(Bun.resolveSync("object-hash", dirname(original.entry))))
  const privateRuntime = await import(pathToFileURL(privateRuntimeEntry).href)
  const originalRuntime = await import(pathToFileURL(originalRuntimeEntry).href)
  assert.notEqual(privateRuntime.SolverRuntime, originalRuntime.SolverRuntime)
  // Both lanes import this original URL so unrelated published exports retain identity.
  writeFileSync(entry, `export * from ${JSON.stringify(pathToFileURL(original.entry).href)};\nexport { AutoroutingPipelineSolver9_PreloadedTraceGraph, AutoroutingPipelineSolver9_PreloadedTraceGraph as AutoroutingPipelineSolver } from "./source-pipeline9/index.js";\n`)
  assert.equal(realpathSync(join(packageFolder, "node_modules")), sharedDependencies)
  const routing = await import(pathToFileURL(sourceEntry).href)
  const wrapped = await import(pathToFileURL(entry).href)
  assert.deepStrictEqual(Object.keys(wrapped).sort(), Object.keys(published).sort())
  for (const name of Object.keys(published)) {
    const expected = ["AutoroutingPipelineSolver", "AutoroutingPipelineSolver9_PreloadedTraceGraph"].includes(name)
      ? routing.AutoroutingPipelineSolver9_PreloadedTraceGraph : published[name]
    assert.equal(wrapped[name], expected, `Export identity changed: ${name}`)
  }
  proof[lane] = {
    variant, entry, sha256: hash(readFileSync(entry)), packageFolder,
    routingSource: frozen.routingSource, originalPublishedAutorouterVersion: original.version,
    sourceEntry, sourceSha256: selected.entrySha256,
    originalEntry: original.entry, originalSha256: original.entrySha256,
    sourceManifest: selected, isolatedSourceRuntime: { original: runtimeOriginal, private: runtimePrivate, version: runtimeMetadata.version, files: runtimeFiles }, preservedExportCount: Object.keys(published).length,
    bothP9AliasesVerified: true, nonP9ExportIdentityVerified: true,
  }
}
assert.equal(proof.base.sha256, proof.pr.sha256, "The common wrapper differs between lanes")
assert.equal(hash(readFileSync(original.entry)), original.entrySha256)
writeFileSync(resolve(outputArg), JSON.stringify(proof, null, 2) + "\n")
console.log("DATASET18_ROUTING_ENTRY_PROOF " + JSON.stringify(proof))
