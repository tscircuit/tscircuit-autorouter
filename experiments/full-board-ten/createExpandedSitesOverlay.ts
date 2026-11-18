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
assert.equal(sha(core), "25f088d42671b5efbf026c70a1216d754c01179e7d767f37e83bef11a0e79fd9")
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
  getCopperLayerNames3: "getCopperLayerNames", distance16: "distance",
  targetLayer2: "targetLayer", t48: "t", p2: "p", point52: "point", o2: "o",
  d2: "d", ix2: "ix", iy2: "iy", a2: "a", b2: "b", x2: "x", y2: "y",
  index2: "index", scene2: "scene", c2: "c", n2: "n",
}
const externalAliases: Record<string, string> = {
  getCopperLayerNames: "getCopperLayerNames3", distance: "distance16",
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
function importDetails(node: any): object {
  assert(ts.isImportDeclaration(node))
  const clause = node.importClause
  assert(!clause?.namedBindings || ts.isNamedImports(clause.namedBindings))
  return {
    module: node.moduleSpecifier.text,
    defaultName: clause?.name?.text,
    isTypeOnly: clause?.isTypeOnly,
    named: clause?.namedBindings?.elements.map((item: any) => ({
      name: item.name.text, propertyName: item.propertyName?.text, isTypeOnly: item.isTypeOnly,
    })) ?? [],
  }
}
function verifySourceScope(before: any, after: any, name: string): object {
  assert.equal(before.statements.length, after.statements.length, "Unexpected top-level declaration change")
  const importChanges = []
  for (let index = 0; index < before.statements.length; index++) {
    const oldNode = before.statements[index], newNode = after.statements[index]
    if (oldNode.name?.text === name) {
      assert.equal(newNode.name?.text, name)
      assert(ts.isFunctionDeclaration(oldNode) && ts.isFunctionDeclaration(newNode))
      assert(oldNode.body && newNode.body)
      if (name === "expandedSignalSites") {
        const signature = (node: any, file: any): string => node.getText(file).slice(0, node.body.getStart(file) - node.getStart(file)) + "{}"
        assert.deepEqual(tokens(signature(oldNode, before)), tokens(signature(newNode, after)), "Generator signature changed")
      } else {
        assert.equal(name, "routingBounds")
        assert.equal(oldNode.modifiers?.length ?? 0, 0)
        assert.equal(newNode.modifiers?.length, 1)
        assert.equal(newNode.modifiers[0].kind, ts.SyntaxKind.ExportKeyword)
        assert.deepEqual(oldNode.parameters.map((node: any) => tokens(node.getText(before))), newNode.parameters.map((node: any) => tokens(node.getText(after))))
        assert.equal(oldNode.typeParameters, undefined)
        assert.equal(newNode.typeParameters, undefined)
        assert.equal(oldNode.type, undefined)
        if (newNode.type) assert.equal(newNode.type.getText(after).replace(/\s+/g, ""), 'SimpleRouteJson["bounds"]')
        assert.deepEqual(tokens(oldNode.body.getText(before)), tokens(newNode.body.getText(after)), "routingBounds implementation changed")
        assert.deepEqual(tokens(runtimeFragment(before, oldNode)), tokens(runtimeFragment(after, newNode)), "routingBounds runtime changed")
      }
      continue
    }
    if (name === "expandedSignalSites" && ts.isImportDeclaration(oldNode) && oldNode.moduleSpecifier.text === "./grid-visibility") {
      const oldImport: any = importDetails(oldNode), newImport: any = importDetails(newNode)
      assert.deepEqual(oldImport.named, [{ name: "GridVisibilitySearch", propertyName: undefined, isTypeOnly: false }])
      assert.deepEqual(newImport, {
        ...oldImport,
        named: [...oldImport.named, { name: "routingBounds", propertyName: undefined, isTypeOnly: false }],
      }, "Only the existing routingBounds helper may be imported")
      importChanges.push({ module: "./grid-visibility", added: "routingBounds" })
      continue
    }
    assert.deepEqual(tokens(oldNode.getText(before)), tokens(newNode.getText(after)), `Unrelated source statement changed at index ${index}`)
  }
  assert.equal(importChanges.length, name === "expandedSignalSites" ? 1 : 0)
  return { allOtherStatementsUnchanged: true, importChanges }
}

const definitions = [
  { relative: "lib/expanded-signal-sites.ts", name: "expandedSignalSites", baseSha256: "d7cc650f000963a739eb0bf436a01005b9e87f86c6c35d254cf6e68cfa30392a" },
  { relative: "lib/grid-visibility.ts", name: "routingBounds", baseSha256: "ab20bee43e199abc3b98662d83436f2b47b1a45834a71ddc2973bf8f66cfdb99" },
]
const sourceFiles: Record<string, { beforeSha256: string; afterSha256: string }> = {}
const sourceScopeQualification = []
const unchangedDeclarations = []
const spans = []
for (const { relative, name, baseSha256 } of definitions) {
  const beforeText = readFileSync(join(baseRoot, relative), "utf8"), afterText = readFileSync(join(candidateRoot, relative), "utf8")
  assert.equal(sha(beforeText), baseSha256, `Source does not match published Bus62: ${relative}`)
  sourceFiles[relative] = { beforeSha256: sha(beforeText), afterSha256: sha(afterText) }
  const before = parse(beforeText), after = parse(afterText)
  assert.equal(before.parseDiagnostics.length, 0); assert.equal(after.parseDiagnostics.length, 0)
  sourceScopeQualification.push({ relative, declaration: name, ...verifySourceScope(before, after, name) })
  const beforeNode = getDeclaration(before, name), afterNode = getDeclaration(after, name)
  const declaration = getDeclaration(published, name), oldBlock = declaration.getText(published)
  const baseline = runtimeFragment(before, beforeNode), candidate = runtimeFragment(after, afterNode)
  const baselineTokens = tokens(baseline), oldTokens = tokens(transpiler.transformSync(oldBlock), bundledAliases)
  assert.deepEqual(oldTokens, baselineTokens, `Published source mismatch: ${name}`)
  const importedNames: string[] = before.statements.filter(ts.isImportDeclaration).flatMap((node: any) => node.importClause?.namedBindings?.elements?.map((item: any) => item.name.text) ?? [])
  verifyAliasBindings(transpiler.transformSync(oldBlock), bundledAliases, [], importedNames)
  verifyAliasBindings(baseline, {}, [], importedNames)
  verifyAliasBindings(candidate, {}, [], name === "expandedSignalSites" ? [...importedNames, "routingBounds"] : importedNames)
  if (name === "routingBounds") {
    assert.deepEqual(tokens(candidate), baselineTokens)
    unchangedDeclarations.push({ name, relative, publishedFragmentSha256: sha(oldBlock), tokenSha256: sha(JSON.stringify(baselineTokens)), runtimeUnchanged: true, sourceExportAdded: true })
    continue
  }
  assert.notDeepEqual(tokens(candidate), baselineTokens, "Candidate must actually change the selected function")
  const newBlock = candidate.replace(/\b(getCopperLayerNames|distance)\b/g, name => externalAliases[name])
  assert.deepEqual(tokens(newBlock, bundledAliases), tokens(candidate), "Candidate aliasing changed semantics")
  verifyAliasBindings(newBlock, bundledAliases, [], [...importedNames, "routingBounds"])
  const characterOffset = start + declaration.getStart(published)
  assert.equal(core.slice(characterOffset, characterOffset + oldBlock.length), oldBlock)
  assert.equal(core.split(oldBlock).length - 1, 1)
  spans.push({ kind: "replace", name, relative, oldBlock, newBlock, characterOffset,
    byteOffset: Buffer.byteLength(core.slice(0, characterOffset)),
    oldBlockSha256: sha(oldBlock), newBlockSha256: sha(newBlock),
    beforeTokenSha256: sha(JSON.stringify(baselineTokens)), afterTokenSha256: sha(JSON.stringify(tokens(candidate))) })
}
assert.equal(spans.length, 1)
assert.equal(spans[0].name, "expandedSignalSites")
assert.equal(unchangedDeclarations.length, 1)
assert.equal(unchangedDeclarations[0].name, "routingBounds")
const span = spans[0]
assert(span.characterOffset >= start && span.characterOffset + span.oldBlock.length <= end)
const candidateCore = core.slice(0, span.characterOffset) + span.newBlock + core.slice(span.characterOffset + span.oldBlock.length)
const candidateBus = candidateCore.slice(start, end + candidateCore.length - core.length)
const candidateParsed = parse(candidateBus)
assert.equal(candidateParsed.parseDiagnostics.length, 0)
assert.equal(getDeclaration(candidateParsed, "routingBounds").getText(candidateParsed), getDeclaration(published, "routingBounds").getText(published))

// A new call resolves to the already published helper, not a shadowed local or new global.
const bindingFilename = "/qualification/candidate-bus.ts"
const host = ts.createCompilerHost({ noLib: true })
host.getSourceFile = (name: string): any => name === bindingFilename ? ts.createSourceFile(name, candidateBus, ts.ScriptTarget.Latest, true) : undefined
host.fileExists = (name: string): boolean => name === bindingFilename
host.readFile = (name: string): string | undefined => name === bindingFilename ? candidateBus : undefined
const program = ts.createProgram([bindingFilename], { noLib: true, types: [], target: ts.ScriptTarget.ESNext }, host)
const checkedFile = program.getSourceFile(bindingFilename), checker = program.getTypeChecker()
const routingBoundsDeclaration = getDeclaration(checkedFile, "routingBounds")
const expectedBinding = checker.getSymbolAtLocation(routingBoundsDeclaration.name)
assert(expectedBinding)
let verifiedHelperCalls = 0
const verifyCalls = (node: any): void => {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "routingBounds") {
    assert.equal(checker.getSymbolAtLocation(node.expression), expectedBinding)
    assert.equal(node.arguments.length, routingBoundsDeclaration.parameters.length)
    verifiedHelperCalls++
  }
  ts.forEachChild(node, verifyCalls)
}
verifyCalls(getDeclaration(checkedFile, "expandedSignalSites"))
assert.equal(verifiedHelperCalls, 1)
function collectCalls(file: any): object[] {
  const calls = []
  const visit = (node: any): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "expandedSignalSites")
      calls.push({ argumentCount: node.arguments.length, tokens: tokens(node.getText(file)) })
    ts.forEachChild(node, visit)
  }
  visit(file)
  return calls
}
const publishedCalls = collectCalls(published), candidateCalls = collectCalls(candidateParsed)
assert(publishedCalls.length > 0)
assert.deepEqual(candidateCalls, publishedCalls, "External expandedSignalSites call sites changed")
const publishedCallCoverage = { function: "expandedSignalSites", publishedCallCount: publishedCalls.length, candidateCallCount: candidateCalls.length, allCallArgumentsAndArityUnchanged: true }
const unchangedSegments = [
  { start: 0, end: span.characterOffset, sha256: sha(core.slice(0, span.characterOffset)) },
  { start: span.characterOffset + span.oldBlock.length, end: core.length, sha256: sha(core.slice(span.characterOffset + span.oldBlock.length)) },
]
const { oldBlock: _old, newBlock: _new, ...declarationProof } = span
const proof = {
  passed: true, schemaVersion: 2, sourceCandidateCommit,
  sourceCommitProvenance: "Revision supplied by the controller; its installer authenticates the exact source patch and before/after file hashes.",
  bun: Bun.version, typescript: ts.version, sourceFiles, sourceScopeQualification, publishedCallCoverage,
  originalCoreSha256: sha(core), originalBusModuleSha256: sha(bus), candidateCoreSha256: sha(candidateCore),
  bundledAliases, externalAliases, unchangedSegments, unchangedDeclarations,
  replacedDeclarations: [declarationProof], insertedDeclarations: [],
  existingHelperBindingQualification: { name: "routingBounds", verifiedCalls: verifiedHelperCalls, existingPublishedBinding: true, arityUnchanged: true },
  nativeRoutingExecuted: false, moduleImported: false,
  normalization: "Same Bun syntax transformation and parser-aware leaf tokens. Object shorthand and binding patterns retain property keys and defaults; bundled identifier aliases are checked against lexical bindings. Only expandedSignalSites changes. Existing routingBounds runtime and all other source statements remain unchanged; its source export/import merely exposes the same existing bundled binding. Only two imported aliases are rewritten. Mathematical bound coverage is not a claim of byte-identical floating-point search coordinates or output.",
}
mkdirSync(output, { recursive: true })
writeFileSync(join(output, "source-mapping.json"), JSON.stringify(proof, null, 2) + "\n")
writeFileSync(join(output, "overlay-spans.json"), JSON.stringify({ ...proof, spans }, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, sourceFiles, candidateCoreSha256: proof.candidateCoreSha256, declarations: spans.map(span => span.name) }))
