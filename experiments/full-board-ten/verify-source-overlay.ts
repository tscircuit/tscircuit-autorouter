import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** Verify the ordinary package bindings before constructing any circuit. */
export async function verifySourceOverlay(runtimeManifestPath: string): Promise<Record<string, unknown>> {
  const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
  const manifest = JSON.parse(readFileSync(runtimeManifestPath, "utf8"))
  assert.equal(manifest.sourceOverrides, true)
  const proofBytes = readFileSync(manifest.sourceOverlay.path)
  assert.equal(sha(proofBytes), manifest.sourceOverlay.sha256)
  const overlay = JSON.parse(proofBytes.toString())
  assert.equal(overlay.routingSourceOverride, true)
  for (const [path, hash] of [
    [overlay.wrapperEntry, overlay.wrapperSha256],
    [overlay.publishedCopyEntry, overlay.publishedCopySha256],
    [overlay.sourceEntry, overlay.sourceSha256],
    [overlay.publishedPackage.entry, overlay.publishedPackage.entrySha256],
  ]) assert.equal(sha(readFileSync(path)), hash)
  for (const entry of manifest.packages) {
    const resolved = fileURLToPath(import.meta.resolve(entry.name))
    assert.equal(realpathSync(resolved), realpathSync(entry.entry), entry.name)
    assert.equal(sha(readFileSync(resolved)), entry.entrySha256, entry.name)
    assert.equal(realpathSync(Bun.resolveSync("@tscircuit/capacity-autorouter", dirname(resolved))), realpathSync(overlay.wrapperEntry), entry.name)
  }
  for (const dependency of ["@tscircuit/solver-utils", "object-hash"]) {
    assert.equal(realpathSync(Bun.resolveSync(dependency, dirname(overlay.sourceEntry))),
      realpathSync(Bun.resolveSync(dependency, dirname(overlay.publishedPackage.entry))), dependency)
  }

  const original = await import(pathToFileURL(overlay.publishedCopyEntry).href)
  const initialCache = (globalThis as any).TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
  assert(initialCache, "Published cache must initialize before source import")
  assert.deepEqual(initialCache.getAllCacheKeys(), [], "A fresh process must not begin with warmed routing results")
  const wrapped = await import("@tscircuit/capacity-autorouter")
  const source = await import(pathToFileURL(overlay.sourceEntry).href)
  assert.equal(typeof source.AutoroutingPipelineSolver9_PreloadedTraceGraph.prototype.stepAsync, "undefined")
  const aliases = ["AutoroutingPipelineSolver9_PreloadedTraceGraph", "AutoroutingPipelineSolver"]
  assert.deepEqual(Object.keys(wrapped).sort(), Object.keys(original).sort())
  for (const name of Object.keys(original)) {
    assert.equal(wrapped[name], aliases.includes(name) ? source.AutoroutingPipelineSolver9_PreloadedTraceGraph : original[name], name)
  }
  assert.equal((globalThis as any).TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE, initialCache)
  assert.deepEqual(initialCache.getAllCacheKeys(), [])
  const core = await import("@tscircuit/core")
  const main = await import("tscircuit")
  for (const name of aliases) {
    assert.equal(core.SOLVERS[name], source.AutoroutingPipelineSolver9_PreloadedTraceGraph, `Core ${name}`)
    assert.equal(main.SOLVERS[name], source.AutoroutingPipelineSolver9_PreloadedTraceGraph, `main ${name}`)
  }
  assert.equal((globalThis as any).TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE, initialCache)
  assert.deepEqual(initialCache.getAllCacheKeys(), [])
  return {
    variant: overlay.variant, routingSourceOverride: true,
    wrapperSha256: overlay.wrapperSha256, sourceSha256: overlay.sourceSha256,
    publishedEntrySha256: overlay.publishedPackage.entrySha256,
    exportCount: Object.keys(original).length, overriddenAliases: aliases,
    allOtherExportsIdentical: true, coreAndMainBindingsVerified: true,
    sharedEmptyCacheBeforeRouting: true, circuitConstructed: false,
  }
}

if (import.meta.main) {
  const [manifestPath, outputPath] = process.argv.slice(2)
  assert(manifestPath && outputPath, "Usage: verify-source-overlay.ts MANIFEST OUTPUT")
  const proof = await verifySourceOverlay(manifestPath)
  writeFileSync(outputPath, JSON.stringify(proof, null, 2) + "\n")
  console.log(JSON.stringify(proof))
}
