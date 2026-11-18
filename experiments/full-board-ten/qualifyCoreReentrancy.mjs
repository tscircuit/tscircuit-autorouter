import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [rootArgument, sourceProofArgument, typescriptPath] = process.argv.slice(2)
const ts = (await import(typescriptPath ?? "typescript")).default
const root = resolve(rootArgument)
const sourceProof = resolve(sourceProofArgument)
const sha = value => createHash("sha256").update(value).digest("hex")
const read = path => readFileSync(path, "utf8")
const result = JSON.parse(read(join(sourceProof, "result.json")))
assert.equal(result.passed, true)
const publishedHash = "53798b0d37ae966acca93e503de4d20e6bb98086d9ec27313646030c364ec519"
const sourcePath = "lib/IsolatedCircuit.ts"
const sourceModule = text => {
  const start = text.indexOf(`// ${sourcePath}\n`)
  assert(start >= 0)
  const next = text.indexOf("\n// ", start + 1)
  return text.slice(start, next < 0 ? text.length : next)
}
function members(text, name) {
  const file = ts.createSourceFile(name, sourceModule(text), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(file.parseDiagnostics.length, 0)
  const classes = file.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).filter(declaration => declaration.name.getText(file) === "IsolatedCircuit")
  assert.equal(classes.length, 1)
  const get = memberName => {
    const found = classes[0].initializer.members.filter(member => member.name?.getText(file) === memberName)
    assert.equal(found.length, 1, `Expected one ${memberName} in ${name}`)
    return found[0].getText(file)
  }
  return { get }
}
const base = read(join(sourceProof, "base/dist/index.js"))
const candidate = read(join(sourceProof, "candidate/dist/index.js"))
const published = read(join(root, "npm/core/dist/index.js"))
assert.equal(sha(published), publishedHash)
const before = members(base, "base.js"), after = members(candidate, "candidate.js"), target = members(published, "published.js")
const oldRender = before.get("render"), newRender = after.get("render")
assert.equal(target.get("render"), oldRender, "Published render preimage differs from qualified source")
assert.equal(target.get("_hasRenderedAtleastOnce"), before.get("_hasRenderedAtleastOnce"))
assert.equal(after.get("_isRendering"), "_isRendering = false;")
function replaceOnce(text, search, replacement) {
  assert.equal(text.split(search).length, 2, "Scoped replacement must have one match")
  return text.replace(search, replacement)
}
const field = "  _isRendering = false;\n"
const normalized = replaceOnce(replaceOnce(candidate, newRender, oldRender), field, "")
assert.equal(normalized, base, "Compiled source differs outside the render guard")
const baseDist = join(sourceProof, "base/dist"), candidateDist = join(sourceProof, "candidate/dist")
const files = readdirSync(baseDist).filter(name => name.endsWith(".js")).sort()
assert.deepEqual(readdirSync(candidateDist).filter(name => name.endsWith(".js")).sort(), files)
for (const name of files.filter(name => name !== "index.js")) {
  assert.equal(read(join(baseDist, name)), read(join(candidateDist, name)), `Unrelated compiled source changed: ${name}`)
}
let output = replaceOnce(published, oldRender, newRender)
const anchor = "  _hasRenderedAtleastOnce = false;\n"
output = replaceOnce(output, anchor, anchor + field)
const mapped = members(output, "mapped.js")
assert.equal(mapped.get("render"), newRender)
assert.equal(mapped.get("_isRendering"), after.get("_isRendering"))
assert.equal(replaceOnce(replaceOnce(output, newRender, oldRender), field, ""), published)
const destination = join(root, "core-reentrancy/reviewed-overlay/dist")
mkdirSync(destination, { recursive: true })
writeFileSync(join(destination, "index.js"), output)
const runtimeChanges = [{ path: "dist/index.js", beforeSha256: publishedHash, afterSha256: sha(output), bytes: Buffer.byteLength(output) }]
const report = {
  assertionsPassed: true,
  sourceResultSha256: sha(read(join(sourceProof, "result.json"))),
  sourcePatchSha256: sha(read(join(sourceProof, "production.patch"))),
  sourceMethodBodyEquality: ["_queueAsyncEffect"],
  genericSchedulingUnchanged: true,
  sourceBuildToPublishedBaseEquivalence: true,
  sourceBuildEquivalenceScope: "The render method and adjacent initialization anchor match byte-for-byte; no claim of whole-package equality between published and source-base builds.",
  candidateMappingSemanticallyIdentical: true,
  sourceBuildOutsideGuardByteIdentical: true,
  publishedBytesOutsideGuardUnchanged: true,
  scope: "Only IsolatedCircuit._isRendering initialization and IsolatedCircuit.render; every other published byte is unchanged.",
  mappings: [{ sourcePath, beforeRenderSha256: sha(oldRender), afterRenderSha256: sha(newRender), field: after.get("_isRendering") }],
  runtimeChanges,
}
writeFileSync(join(root, "core-reentrancy/source-gate.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(root, "core-reentrancy/runtime-changes.json"), JSON.stringify(runtimeChanges, null, 2) + "\n")
console.log(JSON.stringify({ assertionsPassed: true, runtimeChanges }))
