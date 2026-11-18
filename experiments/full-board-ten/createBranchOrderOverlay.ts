import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { gunzipSync } from "node:zlib"
import { join, resolve } from "node:path"

const [baseRoot, candidateRoot, corePath, typescriptPath, outputArgument, sourceCandidateCommit] = process.argv.slice(2)
assert(baseRoot && candidateRoot && corePath && typescriptPath && outputArgument && sourceCandidateCommit)
assert(/^[0-9a-f]{40}$/.test(sourceCandidateCommit), "Source revision must be an exact commit ID")
assert.equal(Bun.version, "1.4.3")
const require = createRequire(import.meta.url)
const ts = require(resolve(typescriptPath))
assert.equal(ts.version, "5.9.3")
const output = resolve(outputArgument)
const bytes = readFileSync(corePath)
const core = (corePath.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString()
const sha = (value: string): string => createHash("sha256").update(value).digest("hex")
assert.equal(sha(core), "f8122fb04b46cb37bf48de0f8642044bc8360937a03630e4655112cc8694471b")
const marker = "// node_modules/@tscircuit/bus-lanes-solver/dist/index.js"
const start = core.indexOf(marker), end = core.indexOf("\n// ", start + 3) + 1
assert(start >= 0 && end > start && core.indexOf(marker, start + marker.length) === -1)
const bus = core.slice(start, end)
assert.equal(sha(bus), "b0ba29b5b2db66be7218ea0896b179281aba3ddc39fbe7eeb472e4de1959f249")
const parse = (text: string): any => ts.createSourceFile("mapping.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const published = parse(bus)
assert.equal(published.parseDiagnostics.length, 0)
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", treeShaking: false })
const bundledAliases: Record<string, string> = {
  getCopperLayerNames3: "getCopperLayerNames", getRouteViaSpanLayers3: "getRouteViaSpanLayers",
  point52: "point", a2: "a", b2: "b",
}
const externalAliases: Record<string, string> = {
  getCopperLayerNames: "getCopperLayerNames3", getRouteViaSpanLayers: "getRouteViaSpanLayers3",
}
function tokens(text: string, aliases: Record<string, string> = {}): Array<{ kind: string; text: string }> {
  const file = parse(text)
  assert.equal(file.parseDiagnostics.length, 0)
  const rows: Array<{ kind: string; text: string }> = []
  const visit = (node: any): void => {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return
    if (ts.isShorthandPropertyAssignment(node) || (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && !node.propertyName && ts.isIdentifier(node.name) && !node.dotDotDotToken)) {
      assert(!node.objectAssignmentInitializer, "Unsupported shorthand assignment initializer")
      rows.push({ kind: "Identifier", text: node.name.text }, { kind: "ColonToken", text: ":" }, { kind: "Identifier", text: aliases[node.name.text] ?? node.name.text })
      if (ts.isBindingElement(node) && node.initializer) { rows.push({ kind: "EqualsToken", text: "=" }); visit(node.initializer) }
      return
    }
    const children = node.getChildren(file)
    if (children.length) children.forEach(visit)
    else if (node.getText(file)) rows.push({ kind: ts.SyntaxKind[node.kind], text: ts.isIdentifier(node) ? aliases[node.text] ?? node.text : node.getText(file) })
  }
  visit(file)
  return rows
}
function verifyAliasBindings(text: string, aliases: Record<string, string> = {}, extraLocalNames: string[] = [], importedNames: string[] = []): void {
  const filename = "/qualification/pipeline.ts"
  const host = ts.createCompilerHost({ noLib: true })
  host.getSourceFile = (name: string): any => name === filename ? ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true) : undefined
  host.fileExists = (name: string): boolean => name === filename
  host.readFile = (name: string): string | undefined => name === filename ? text : undefined
  const program = ts.createProgram([filename], { noLib: true, types: [], target: ts.ScriptTarget.ESNext }, host)
  const checker = program.getTypeChecker(), file = program.getSourceFile(filename)
  const externalNames = new Set([...Object.keys(externalAliases), ...importedNames])
  const localNames = new Set([...Object.values(bundledAliases).filter(name => !externalNames.has(name)), ...extraLocalNames])
  const visit = (node: any): void => {
    const name = aliases[node.text] ?? node.text
    if (ts.isIdentifier(node) && (externalNames.has(name) || localNames.has(name))) {
      const property = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        (ts.isMethodDeclaration(node.parent) && node.parent.name === node) ||
        (ts.isBindingElement(node.parent) && node.parent.propertyName === node)
      if (property) { assert(!(name in externalAliases)); assert.equal(node.text, name, "A bundled alias cannot rename a property"); return }
      const symbol = checker.getSymbolAtLocation(node)
      const isLocal = Boolean(symbol?.declarations?.some((declaration: any) => declaration.getSourceFile() === file))
      assert.equal(isLocal, !externalNames.has(name), `Unexpected lexical binding: ${node.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}

function getDeclaration(file: any, name: string): any {
  const nodes = file.statements.filter((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.equal(nodes.length, 1, `Expected one function declaration: ${name}`)
  return nodes[0]
}
function runtimeFragment(file: any, node: any): string {
  return transpiler.transformSync(node.getText(file).replace(/^export\s+/, ""))
}
function runtimeImports(file: any): object[] {
  return file.statements.filter(ts.isImportDeclaration).filter((node: any) => !node.importClause?.isTypeOnly).map((node: any) => {
    const clause = node.importClause
    assert(!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
    return { module: node.moduleSpecifier.text, names: clause.namedBindings.elements.filter((item: any) => !item.isTypeOnly).map((item: any) => ({ name: item.name.text, propertyName: item.propertyName?.text })).sort((a: any, b: any) => a.name.localeCompare(b.name)) }
  }).sort((a: any, b: any) => a.module.localeCompare(b.module))
}
function verifySourceScope(before: any, after: any, name: string): object {
  const expectedImports = [...runtimeImports(before)]
  expectedImports.sort((a: any, b: any) => a.module.localeCompare(b.module))
  assert.deepEqual(runtimeImports(after), expectedImports, "Unexpected runtime import change")
  const runtimeStatements = (file: any): any[] => file.statements.filter((node: any) => !ts.isImportDeclaration(node) && tokens(runtimeFragment(file, node)).length > 0)
  const oldStatements = runtimeStatements(before)
  const newStatements = runtimeStatements(after)
  assert.equal(oldStatements.length, newStatements.length, "Unexpected top-level declaration change")
  let changed = 0
  for (let i = 0; i < oldStatements.length; i++) {
    const oldNode = oldStatements[i], newNode = newStatements[i]
    if (ts.isFunctionDeclaration(oldNode) && oldNode.name?.text === name) {
      assert(ts.isFunctionDeclaration(newNode) && newNode.name?.text === name)
      changed++
    } else assert.deepEqual(tokens(runtimeFragment(before, oldNode)), tokens(runtimeFragment(after, newNode)), `Unrelated source statement changed: ${i}`)
  }
  assert.equal(changed, 1)
  return { allOtherRuntimeStatementsUnchanged: true, erasedTypeDeclarationsAllowed: true, runtimeImports: expectedImports }
}

const definitions = [
  { relative: "lib/route-multi-terminal-buses.ts", name: "routeMultiTerminalBuses", baseSha256: "d2f523d4fd33e28129888f6a2734b377daa5e3efaa9e3ec15e34ec36200980f6" },
]
const sourceFiles: Record<string, { beforeSha256: string | null; afterSha256: string }> = {}
const sourceScopeQualification = [], spans: any[] = []
for (const { relative, name, baseSha256 } of definitions) {
  const beforeText = readFileSync(join(baseRoot, relative), "utf8"), afterText = readFileSync(join(candidateRoot, relative), "utf8")
  assert.equal(sha(beforeText), baseSha256, `Source does not match published Bus62: ${relative}`)
  sourceFiles[relative] = { beforeSha256: sha(beforeText), afterSha256: sha(afterText) }
  const before = parse(beforeText), after = parse(afterText)
  assert.equal(before.parseDiagnostics.length, 0); assert.equal(after.parseDiagnostics.length, 0)
  sourceScopeQualification.push({ relative, ...verifySourceScope(before, after, name) })
  const beforeNode = getDeclaration(before, name), afterNode = getDeclaration(after, name)
  const declaration = getDeclaration(published, name), oldBlock = declaration.getText(published)
  const baseline = runtimeFragment(before, beforeNode), candidate = runtimeFragment(after, afterNode)
  const baselineTokens = tokens(baseline)
  assert.deepEqual(tokens(runtimeFragment(published, declaration), bundledAliases), baselineTokens, `Published source mismatch: ${name}`)
  const imports: string[] = before.statements.filter(ts.isImportDeclaration).flatMap((node: any) => node.importClause?.namedBindings?.elements?.map((item: any) => item.name.text) ?? [])
  verifyAliasBindings(runtimeFragment(published, declaration), bundledAliases, [], imports)
  verifyAliasBindings(baseline, {}, [], imports)
  verifyAliasBindings(candidate, {}, [], imports)
  assert.notDeepEqual(tokens(candidate), baselineTokens, "Candidate must change the declared span")
  const newBlock = candidate.replace(/\b(getCopperLayerNames|getRouteViaSpanLayers)\b/g, id => externalAliases[id])
  assert.deepEqual(tokens(newBlock, bundledAliases), tokens(candidate), "Aliasing changed candidate semantics")
  verifyAliasBindings(newBlock, bundledAliases, [], imports)
  const characterOffset = start + declaration.getStart(published)
  assert.equal(core.slice(characterOffset, characterOffset + oldBlock.length), oldBlock)
  assert.equal(core.split(oldBlock).length - 1, 1)
  spans.push({ kind: "replace", name, relative, oldBlock, newBlock, characterOffset, byteOffset: Buffer.byteLength(core.slice(0, characterOffset)), oldBlockSha256: sha(oldBlock), newBlockSha256: sha(newBlock), beforeTokenSha256: sha(JSON.stringify(baselineTokens)), afterTokenSha256: sha(JSON.stringify(tokens(candidate))) })
}
assert.equal(spans.length, 1)
const ordered = [...spans].sort((a, b) => a.characterOffset - b.characterOffset || (a.kind === "insert" ? -1 : 1))
let previous = 0
const unchangedSegments = []
for (const span of ordered) {
  assert(span.characterOffset >= start && span.characterOffset + span.oldBlock.length <= end)
  assert(span.characterOffset >= previous, "Overlapping source replacements")
  unchangedSegments.push({ start: previous, end: span.characterOffset, sha256: sha(core.slice(previous, span.characterOffset)) })
  previous = span.characterOffset + span.oldBlock.length
}
unchangedSegments.push({ start: previous, end: core.length, sha256: sha(core.slice(previous)) })
let candidateCore = core
for (const span of [...ordered].reverse()) candidateCore = candidateCore.slice(0, span.characterOffset) + span.newBlock + candidateCore.slice(span.characterOffset + span.oldBlock.length)
const candidateBus = candidateCore.slice(start, end + candidateCore.length - core.length), candidateParsed = parse(candidateBus)
assert.equal(candidateParsed.parseDiagnostics.length, 0)
const unchangedDeclarations: object[] = []
function collectCalls(file: any): object[] {
  const calls: object[] = []
  const visit = (node: any): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "routeMultiTerminalBuses") calls.push({ argumentCount: node.arguments.length, tokens: tokens(node.getText(file), bundledAliases) })
    ts.forEachChild(node, visit)
  }
  visit(file); return calls
}
const publishedCalls = collectCalls(published), candidateCalls = collectCalls(candidateParsed)
assert(publishedCalls.length > 0); assert.deepEqual(candidateCalls, publishedCalls, "External router calls changed")
const declarations = spans.map(({ oldBlock, newBlock, ...row }) => row)
const proof = {
  passed: true, schemaVersion: 2, sourceCandidateCommit,
  sourceCommitProvenance: "Revision supplied by controller; installer authenticates exact source patch and before/after file hashes.",
  bun: Bun.version, typescript: ts.version, sourceFiles, sourceScopeQualification,
  originalCoreSha256: sha(core), originalBusModuleSha256: sha(bus), candidateCoreSha256: sha(candidateCore),
  bundledAliases, externalAliases, unchangedSegments, unchangedDeclarations,
  replacedDeclarations: declarations.filter(row => row.kind === "replace"), insertedDeclarations: declarations.filter(row => row.kind === "insert"),
  publishedCallCoverage: { function: "routeMultiTerminalBuses", callCount: publishedCalls.length, unchangedArgumentsAndArity: true },
  nativeRoutingExecuted: false, moduleImported: false,
  normalization: "Same Bun syntax transform and parser-aware tokens; shorthand preserves keys and bundled aliases are lexically verified. Only routeMultiTerminalBuses is replaced. Runtime imports and every source runtime statement outside this function remain unchanged, as does every Core byte outside the single declaration span. External calls retain their exact arguments and arity. No native completion benefit is claimed.",
}
mkdirSync(output, { recursive: true })
writeFileSync(join(output, "source-mapping.json"), JSON.stringify(proof, null, 2) + "\n")
writeFileSync(join(output, "overlay-spans.json"), JSON.stringify({ ...proof, spans }, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, sourceFiles, candidateCoreSha256: proof.candidateCoreSha256, declarations: spans.map(span => span.name) }))
