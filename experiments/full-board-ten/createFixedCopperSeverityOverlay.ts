import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { gunzipSync } from "node:zlib"

// Static source qualification only. Neither original nor candidate is imported.
const [arRoot, entryPath, mapPath, tsPath, outDir] = process.argv.slice(2)
assert(arRoot && entryPath && mapPath && tsPath && outDir)
const require = createRequire(resolve(tsPath))
const ts = require(resolve(tsPath)), terser = require("terser")
assert.equal(ts.version, "5.9.3")
assert.equal(require("terser/package.json").version, "5.51.2")
const sha = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex")
const read = (file: string): string => (file.endsWith(".gz") ? gunzipSync(readFileSync(file)) : readFileSync(file)).toString()
const original = read(entryPath), sourceMapText = read(mapPath), sourceMap = JSON.parse(sourceMapText)
assert.equal(sha(original), "44e2cc5a759e11f3982a876733d0f224dcb901c0ac0840e2ff1ec5be434a4285")
assert.equal(sha(sourceMapText), "aec2fc7d644bba32defd9e4fa7ec957c78ffdeb37fbfe83d0de780bd5311d5f7")
mkdirSync(outDir, { recursive: true })
const git = (args: string[]): string => execFileSync("git", ["-C", arRoot, ...args], { encoding: "utf8", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } })
const parse = (text: string): any => {
  const file = ts.createSourceFile("qualification.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(file.parseDiagnostics.length, 0)
  return file
}
const programFor = (text: string): any => {
  const fileName = "/qualification/source.ts", options = { noLib: true, types: [], target: ts.ScriptTarget.ESNext }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name: string): any => name === fileName ? parse(text) : undefined
  host.fileExists = (name: string): boolean => name === fileName
  host.readFile = (name: string): string | undefined => name === fileName ? text : undefined
  const program = ts.createProgram([fileName], options, host)
  return { file: program.getSourceFile(fileName), checker: program.getTypeChecker() }
}
function isPropertyName(node: any): boolean {
  const p = node.parent
  return (ts.isPropertyAccessExpression(p) && p.name === node) ||
    ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === node) ||
    (ts.isBindingElement(p) && p.propertyName === node)
}
function lexicalTokens(text: string): Array<{ kind: number; text: string; free: boolean }> {
  const { file, checker } = programFor(text)
  const result: Array<{ kind: number; text: string; free: boolean }> = []
  const visit = (node: any): void => {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return
    const children = node.getChildren(file)
    if (children.length) children.forEach(visit)
    else if (node.getText(file)) result.push({ kind: node.kind, text: node.getText(file),
      free: ts.isIdentifier(node) && !isPropertyName(node) && !checker.getSymbolAtLocation(node) })
  }
  visit(file)
  return result
}
const canonical = async (text: string, prelude = ""): Promise<string> => {
  const wrapped = ts.transpileModule(`export const Qualified = ${text};`, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText
  const result = await terser.minify(prelude + wrapped, { module: true, compress: { passes: 3 }, mangle: { toplevel: true, nth_identifier: { get: (index: number): string => `binding${index}` } } })
  assert(result.code)
  return result.code
}
function deriveAliases(before: string, published: string, label: string): Record<string, string> {
  const left = lexicalTokens(before), right = lexicalTokens(published)
  if (left.length !== right.length) {
    writeFileSync(join(outDir, "qualification-base-fragment.js"), before)
    writeFileSync(join(outDir, "qualification-published-fragment.js"), published)
  }
  assert.equal(left.length, right.length, `${label}: canonical token count`)
  const aliases: Record<string, string> = {}, inverse: Record<string, string> = {}
  left.forEach((token, index) => {
    const other = right[index]
    if (token.kind !== other.kind || (token.text !== other.text && !(token.free && other.free))) {
      writeFileSync(join(outDir, "qualification-base-fragment.js"), before)
      writeFileSync(join(outDir, "qualification-published-fragment.js"), published)
      console.log(JSON.stringify({ qualificationMismatch: label, index, left: left.slice(Math.max(0, index - 5), index + 8), right: right.slice(Math.max(0, index - 5), index + 8) }))
    }
    assert.equal(token.kind, other.kind, `${label}: token kind at ${index}`)
    if (token.text === other.text) return
    assert(token.free && other.free, `${label}: non-global mismatch at ${index}: ${token.text} -> ${other.text}`)
    assert(!aliases[token.text] || aliases[token.text] === other.text, `${label}: inconsistent alias`)
    assert(!inverse[other.text] || inverse[other.text] === token.text, `${label}: alias collision`)
    aliases[token.text] = other.text; inverse[other.text] = token.text
  })
  return aliases
}

const base = "a4f2778cb40bbc9c147b95a4e48ef0b32f1dd08f"
const head = "304f1d45d252a98d7347f33167b007bd859c89f4"
const relative = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedCopperDrcEvaluator.ts"
assert.equal(git(["rev-parse", "HEAD"]).trim(), head)
assert.equal(git(["rev-parse", `${head}^`]).trim(), base)
assert.equal(git(["status", "--porcelain", "--", relative]).trim(), "")
assert.deepEqual(git(["diff", "--name-only", base, head]).trim().split("\n"), [relative])
const before = git(["show", `${base}:${relative}`]), after = git(["show", `${head}:${relative}`])
assert.equal(read(join(arRoot, relative)), after)
const mapIndex = sourceMap.sources.indexOf(`../${relative}`)
assert(mapIndex >= 0)
assert.equal(sourceMap.sourcesContent[mapIndex], before)
const beforeFile = parse(before), afterFile = parse(after), publishedFile = parse(original)
const messages = ["Trace is too close to fixed copper on its layer", "Via is too close to fixed copper on a drilled layer"]
function messageProperty(file: any, message: string): any {
  const matches: any[] = []
  const visit = (node: any): void => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === "message") {
      const text = node.initializer
      if ((ts.isStringLiteral(text) && text.text === message) || (ts.isTemplateExpression(text) && text.head.text === message + " (gap: ")) matches.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(matches.length, 1, message)
  return matches[0]
}
function objectProperty(object: any, name: string, file: any): any {
  assert(ts.isObjectLiteralExpression(object))
  const matches = object.properties.filter((node: any) => ts.isPropertyAssignment(node) && node.name.getText(file) === name)
  assert.equal(matches.length, 1, name)
  return matches[0].initializer
}
function enclosingTopVariable(node: any): any {
  let current = node
  while (current.parent) {
    if (ts.isVariableDeclaration(current) && ts.isVariableStatement(current.parent?.parent) && ts.isSourceFile(current.parent.parent.parent)) return current
    current = current.parent
  }
  throw new Error("No enclosing top-level evaluator")
}
const sourceEvaluator = enclosingTopVariable(messageProperty(beforeFile, messages[0]))
assert.equal(sourceEvaluator.name.text, "createPipeline9FixedCopperDrcEvaluator")
function enclosingFixedEvaluator(node: any): any {
  let current = node
  while (current.parent) {
    if (ts.isArrowFunction(current) && current.parameters.length === 1 && ts.isObjectBindingPattern(current.parameters[0].name)) {
      if (current.parameters[0].name.elements.some((element: any) => (element.propertyName ?? element.name).text === "representedPadObstacleIndexes")) return current
    }
    current = current.parent
  }
  throw new Error("No enclosing fixed-copper evaluator")
}
const publishedEvaluator = enclosingFixedEvaluator(messageProperty(publishedFile, messages[0]))
assert.equal(enclosingFixedEvaluator(messageProperty(publishedFile, messages[1])), publishedEvaluator)
const presetIndex = sourceMap.sources.indexOf("../lib/utils/drcPresets.ts")
assert(presetIndex >= 0)
const presetFile = parse(sourceMap.sourcesContent[presetIndex])
const presetDeclaration = presetFile.statements.flatMap((statement: any) => ts.isVariableStatement(statement) ? statement.declarationList.declarations : []).find((node: any) => node.name.text === "RELAXED_DRC_OPTIONS")
assert(presetDeclaration && ts.isSatisfiesExpression(presetDeclaration.initializer))
const sourceTraceClearance = objectProperty(presetDeclaration.initializer.expression, "traceClearance", presetFile)
assert(ts.isNumericLiteral(sourceTraceClearance) && Number(sourceTraceClearance.text) === 0.1)
const publishedTraceClearance = publishedFile.statements.flatMap((statement: any) => ts.isVariableStatement(statement) ? statement.declarationList.declarations : []).find((node: any) => node.name.text === "ST")
assert(publishedTraceClearance && ts.isNumericLiteral(publishedTraceClearance.initializer) && Number(publishedTraceClearance.initializer.text) === 0.1)
const baseCanonical = await canonical(sourceEvaluator.initializer.getText(beforeFile), "const RELAXED_DRC_OPTIONS={traceClearance:0.1};")
const publishedCanonical = await canonical(publishedEvaluator.getText(publishedFile), "const ST=0.1;")
const aliases = deriveAliases(baseCanonical, publishedCanonical, "createPipeline9FixedCopperDrcEvaluator")
const spans: any[] = [], sourceEdits: any[] = []
for (let index = 0; index < messages.length; index++) {
  const message = messages[index], b = messageProperty(beforeFile, message), a = messageProperty(afterFile, message), p = messageProperty(publishedFile, message)
  const actualBefore = objectProperty(b.parent, "actual_clearance", beforeFile).getText(beforeFile)
  const minimumBefore = objectProperty(b.parent, "minimum_clearance", beforeFile).getText(beforeFile)
  assert.equal(objectProperty(a.parent, "actual_clearance", afterFile).getText(afterFile), actualBefore)
  assert.equal(objectProperty(a.parent, "minimum_clearance", afterFile).getText(afterFile), minimumBefore)
  const template = a.initializer
  assert(ts.isTemplateExpression(template) && template.templateSpans.length === 2)
  assert.equal(template.templateSpans[0].expression.getText(afterFile), `(${actualBefore}).toFixed(6)`)
  assert.equal(template.templateSpans[1].expression.getText(afterFile), minimumBefore)
  assert.equal(template.templateSpans[0].literal.text, "mm, required: ")
  assert.equal(template.templateSpans[1].literal.text, "mm)")
  const expressions = [
    `(${objectProperty(p.parent, "actual_clearance", publishedFile).getText(publishedFile)}).toFixed(6)`,
    objectProperty(p.parent, "minimum_clearance", publishedFile).getText(publishedFile),
  ]
  // Preserve the exact candidate template literals; only bind its two expressions
  // to the corresponding existing numeric properties in the published object.
  let replacementText = template.getText(afterFile)
  const templateStart = template.getStart(afterFile)
  for (let spanIndex = 1; spanIndex >= 0; spanIndex--) {
    const expression = template.templateSpans[spanIndex].expression
    replacementText = replacementText.slice(0, expression.getStart(afterFile) - templateStart) + expressions[spanIndex] + replacementText.slice(expression.end - templateStart)
  }
  const startCharacter = p.initializer.getStart(publishedFile), endCharacter = p.initializer.end
  const originalText = original.slice(startCharacter, endCharacter)
  assert.equal(JSON.parse(originalText), message)
  spans.push({ kind: "replace", name: `createPipeline9FixedCopperDrcEvaluator.${index === 0 ? "wire" : "via"}Message`, sourceRepository: "tscircuit/tscircuit-autorouter", sourceRelative: relative, startCharacter, endCharacter,
    startByte: Buffer.byteLength(original.slice(0, startCharacter)), endByte: Buffer.byteLength(original.slice(0, endCharacter)), originalText, replacementText, originalSha256: sha(originalText), replacementSha256: sha(replacementText), compiledBaseEquivalent: true,
    baseCanonicalSha256: sha(publishedCanonical), sourceTemplate: template.getText(afterFile), expressionBindings: { actualClearance: expressions[0], minimumClearance: expressions[1] } })
  sourceEdits.push({ start: templateStart, end: template.end, replacement: b.initializer.getText(beforeFile) })
}
let restoredSource = after
for (const edit of sourceEdits.sort((a, b) => b.start - a.start)) restoredSource = restoredSource.slice(0, edit.start) + edit.replacement + restoredSource.slice(edit.end)
assert.equal(restoredSource, before, "Changes outside the two message initializers")
spans.sort((a, b) => a.startCharacter - b.startCharacter)
let cursor = 0, candidate = ""
const unchangedSegments: any[] = []
for (const span of spans) {
  assert(span.startCharacter >= cursor)
  const unchanged = original.slice(cursor, span.startCharacter)
  unchangedSegments.push({ startByte: Buffer.byteLength(original.slice(0, cursor)), endByte: span.startByte, candidateStartByte: Buffer.byteLength(candidate), candidateEndByte: Buffer.byteLength(candidate + unchanged), sha256: sha(unchanged) })
  candidate += unchanged + span.replacementText
  cursor = span.endCharacter
}
const tail = original.slice(cursor)
unchangedSegments.push({ startByte: Buffer.byteLength(original.slice(0, cursor)), endByte: Buffer.byteLength(original), candidateStartByte: Buffer.byteLength(candidate), candidateEndByte: Buffer.byteLength(candidate + tail), sha256: sha(tail) })
candidate += tail
parse(candidate)
for (const segment of unchangedSegments) assert.equal(sha(Buffer.from(candidate).subarray(segment.candidateStartByte, segment.candidateEndByte)), segment.sha256)
const patchFile = "autorouter-fixed-copper-severity-production.patch"
const patch = git(["diff", "--binary", base, head, "--", relative])
writeFileSync(join(outDir, patchFile), patch)
const source = { repositories: [{ repository: "tscircuit/tscircuit-autorouter", sourceBaseCommit: base, publishedBaseCommit: base, productionPatchFile: patchFile, changedFiles: [{ relative, beforeSha256: sha(before), afterSha256: sha(after) }], candidateCommit: head, productionPatchSha256: sha(patch) }] }
const handoff = { repositories: [{ baseCommit: base, candidateCommit: head, productionClean: true, files: [{ path: relative, production: true, sha256: sha(after) }], patches: { production: { sha256: sha(patch) } } }] }
const handoffText = JSON.stringify(handoff, null, 2) + "\n"
writeFileSync(join(outDir, "mapping-source-handoff.json"), handoffText)
const mapping = { schemaVersion: 2, passed: true, sourceFrozen: true, originalAutorouterSha256: sha(original), candidateAutorouterSha256: sha(candidate), sourceMapSha256: sha(sourceMapText), source, spans, unchangedSegments,
  qualification: { allOutsideBytesUnchanged: true, unrelatedSourceRuntimeUnchanged: true, compiledBaseEquivalent: true, sourceMapGeneratedOffsetsUsed: false, sourceMapIndex: mapIndex,
    typeErasure: "TypeScript5.9.3 transpileModule ESNext; static only",
    canonicalizer: "Terser5.51.2 deterministic local renaming; complete evaluator baseline tokens match modulo bijective free binding aliases",
    baselineEvaluatorAliases: aliases, unchangedInlinedTraceClearance: { sourceMapIndex: presetIndex, value: 0.1, publishedBinding: "ST" }, sourceChangeScope: "Exactly two message initializers; numeric fields and all other source bytes unchanged",
    expressionMapping: "Candidate gap.toFixed(6) and required expressions verified against same-object source actual_clearance/minimum_clearance, then rebound to those same-object published expressions",
    bun: Bun.version, typescript: ts.version, terser: require("terser/package.json").version },
  sourceHandoffSha256: sha(handoffText), mapperSha256: sha(readFileSync(import.meta.path)), moduleImported: false, nativeRoutingExecuted: false }
mkdirSync(join(outDir, "dist"), { recursive: true })
writeFileSync(join(outDir, "dist/fixed-copper-severity-candidate.js"), candidate)
writeFileSync(join(outDir, "fixed-copper-severity-source-mapping.json"), JSON.stringify(mapping, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, replacements: spans.length, candidateAutorouterSha256: mapping.candidateAutorouterSha256, source, moduleImported: false, nativeRoutingExecuted: false }))
