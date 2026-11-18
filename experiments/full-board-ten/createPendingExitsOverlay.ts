import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { gunzipSync } from "node:zlib"
import { join, resolve } from "node:path"

const [baseRoot, candidateRoot, corePath, typescriptPath, outputArgument] = process.argv.slice(2)
assert(baseRoot && candidateRoot && corePath && typescriptPath && outputArgument)
assert.equal(Bun.version, "1.4.3")
const require = createRequire(import.meta.url)
const ts = require(resolve(typescriptPath))
assert.equal(ts.version, "5.9.3")
const output = resolve(outputArgument)
mkdirSync(output, { recursive: true })
const bytes = readFileSync(corePath)
const core = (corePath.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString()
const sha = (value: string): string => createHash("sha256").update(value).digest("hex")
assert.equal(sha(core), "f8a561fdb5f796e6590524bde049412a9e43310416d00ff3b78e33558a65b49d")
const marker = "// node_modules/@tscircuit/bus-lanes-solver/dist/index.js"
const start = core.indexOf(marker), end = core.indexOf("\n// ", start + 3) + 1
assert(start >= 0 && end > start && core.indexOf(marker, start + marker.length) === -1)
const bus = core.slice(start, end)
assert.equal(sha(bus), "b0ba29b5b2db66be7218ea0896b179281aba3ddc39fbe7eeb472e4de1959f249")
const parse = (text: string): any => ts.createSourceFile("mapping.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const published = parse(bus)
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", treeShaking: false })
const bundledAliases: Record<string, string> = {
  BaseSolver9: "BaseSolver", i2: "i", point52: "point", j2: "j", r2: "r", c2: "c",
  getCopperLayerNames3: "getCopperLayerNames", getRouteViaSpanLayers3: "getRouteViaSpanLayers",
  b2: "b", l2: "l", p2: "p", g2: "g", n2: "n", a2: "a", buses2: "buses",
  o2: "o", cross42: "cross", q2: "q", s2: "s", t48: "t", t49: "t",
  _BusLanesSolver: "BusLanesSolver", c3: "c", cost2: "cost", index2: "index",
  current2: "current", fixed2: "fixed", e2: "e", dx2: "dx", dy2: "dy", x2: "x", y2: "y", distance16: "distance", pairs3: "pairs", layer2: "layer", along2: "along", hits2: "hits", applyToPoint36: "applyToPoint",
}
const externalAliases: Record<string, string> = {
  BaseSolver: "BaseSolver9", getCopperLayerNames: "getCopperLayerNames3", getRouteViaSpanLayers: "getRouteViaSpanLayers3", distance: "distance16", applyToPoint: "applyToPoint36",
}
function tokens(text: string, aliases: Record<string, string> = {}): Array<{ kind: string; text: string }> {
  const file = parse(text)
  assert.equal(file.parseDiagnostics.length, 0)
  const rows: Array<{ kind: string; text: string }> = []
  const visit = (node: any): void => {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return
    if (ts.isShorthandPropertyAssignment(node) || (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && !node.propertyName && ts.isIdentifier(node.name) && !node.dotDotDotToken)) {
      assert(!node.objectAssignmentInitializer && !node.initializer, "Unsupported shorthand initializer")
      rows.push({ kind: "Identifier", text: node.name.text }, { kind: "ColonToken", text: ":" }, { kind: "Identifier", text: aliases[node.name.text] ?? node.name.text })
      return
    }
    const children = node.getChildren(file)
    if (children.length) children.forEach(visit)
    else if (node.getText(file)) rows.push({ kind: ts.SyntaxKind[node.kind], text: ts.isIdentifier(node) ? aliases[node.text] ?? node.text : node.getText(file) })
  }
  visit(file)
  return rows
}
function verifyAliasBindings(text: string, aliases: Record<string, string> = {}): void {
  const filename = "/qualification/pipeline.ts"
  const host = ts.createCompilerHost({ noLib: true })
  host.getSourceFile = (name: string): any => name === filename ? ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true) : undefined
  host.fileExists = (name: string): boolean => name === filename
  host.readFile = (name: string): string | undefined => name === filename ? text : undefined
  const program = ts.createProgram([filename], { noLib: true, types: [], target: ts.ScriptTarget.ESNext }, host)
  const checker = program.getTypeChecker(), file = program.getSourceFile(filename)
  const localNames = new Set(Object.values(bundledAliases).filter(name => !(name in externalAliases)))
  const visit = (node: any): void => {
    const name = aliases[node.text] ?? node.text
    if (ts.isIdentifier(node) && (name in externalAliases || localNames.has(name))) {
      const property = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
        (ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        (ts.isMethodDeclaration(node.parent) && node.parent.name === node) ||
        (ts.isBindingElement(node.parent) && node.parent.propertyName === node)
      if (property) { assert(!(name in externalAliases)); assert.equal(node.text, name, "A bundled alias cannot rename a property"); return }
      const symbol = checker.getSymbolAtLocation(node)
      const isLocal = Boolean(symbol?.declarations?.some((declaration: any) => declaration.getSourceFile() === file))
      assert.equal(isLocal, !(name in externalAliases), `Unexpected lexical binding: ${node.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}
const definitions = [
  ["lib/bus-lanes-solver.ts", "BusLanesSolver"],
  ["lib/negotiate-lanes.ts", "negotiateLanes"],
  ["lib/pending-lane-certificates.ts", "pendingPackageExits"],
  ["lib/pending-lane-certificates.ts", "pendingLaneCertificates"],
]

const spans = []
const unchangedDeclarations = []
const sourceFiles: Record<string, { beforeSha256: string; afterSha256: string }> = {}
for (const [relative, name] of definitions) {
  const beforeText = readFileSync(join(baseRoot, relative), "utf8"), afterText = readFileSync(join(candidateRoot, relative), "utf8")
  sourceFiles[relative] = { beforeSha256: sha(beforeText), afterSha256: sha(afterText) }
  const before = parse(beforeText), after = parse(afterText)
  assert.equal(before.parseDiagnostics.length, 0); assert.equal(after.parseDiagnostics.length, 0)
  const beforeImports = before.statements.filter(ts.isImportDeclaration).map((node: any) => node.getText(before))
  const afterImports = after.statements.filter(ts.isImportDeclaration).map((node: any) => node.getText(after))
  const expectedImports = relative === "lib/negotiate-lanes.ts"
    ? beforeImports.map((text: string) => text.replace('import { length }', 'import { distance, length }').replace('SimpleRouteJson, Connection, Trace, Wire', 'SimpleRouteJson, Connection, Point, Trace, Wire'))
    : beforeImports
  assert.deepEqual(afterImports, expectedImports, "Unexpected production import change")
  const fragment = (file: any): string => {
    const declarations = file.statements.filter((node: any) => node.name?.text === name)
    assert.equal(declarations.length, 1)
    let text = declarations[0].getText(file).replace(/^export\s+/, "")
    if (ts.isClassDeclaration(declarations[0])) text = text.replace(`class ${name} extends`, `var ${name} = class ${name} extends`)
    text = transpiler.transformSync(text)
    if (ts.isClassDeclaration(declarations[0])) {
      const js = parse(text)
      const expression = js.statements[0].declarationList.declarations[0].initializer
      const constructors = expression.members.filter(ts.isConstructorDeclaration)
      assert.equal(constructors.length, 1)
      const constructor = constructors[0]
      text = text.slice(0, expression.members.pos) + "\n" + constructor.getText(js) + text.slice(expression.members.pos, constructor.getStart(js)) + text.slice(constructor.end)
    }
    return text
  }
  const baseline = fragment(before), candidate = fragment(after)
  const declarations = published.statements.filter((node: any) => node.name?.text === name ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((item: any) => item.name.text === name)))
  assert.equal(declarations.length, 1)
  const declaration = declarations[0], oldBlock = declaration.getText(published)
  const oldTokens = tokens(transpiler.transformSync(oldBlock), bundledAliases)
  const baseTokens = tokens(baseline)
  assert.equal(oldTokens.length, baseTokens.length, `Token count mismatch: ${name}`)
  const differences = oldTokens.flatMap((token, index) => JSON.stringify(token) === JSON.stringify(baseTokens[index]) ? [] : [{ index, published: token, source: baseTokens[index] }])
  assert.equal(differences.length, 0, `Published source mismatch: ${name}: ${JSON.stringify(differences.slice(0, 20))}`)
  verifyAliasBindings(transpiler.transformSync(oldBlock), bundledAliases)
  verifyAliasBindings(baseline); verifyAliasBindings(candidate)
  let newBlock = candidate.replace(/\b(BaseSolver|getCopperLayerNames|getRouteViaSpanLayers|distance|applyToPoint)\b/g, name => externalAliases[name])
  if (name === "BusLanesSolver") {
    // Preserve the published named-class binding (including constructor.name).
    const filename = "/qualification/class-binding.ts"
    const host = ts.createCompilerHost({ noLib: true })
    host.getSourceFile = (path: string): any => path === filename ? parse(newBlock) : undefined
    host.fileExists = (path: string): boolean => path === filename
    host.readFile = (path: string): string | undefined => path === filename ? newBlock : undefined
    const program = ts.createProgram([filename], { noLib: true, types: [] }, host)
    const file = program.getSourceFile(filename), checker = program.getTypeChecker()
    const declaration = file.statements[0].declarationList.declarations[0]
    const binding = checker.getSymbolAtLocation(declaration.initializer.name)
    assert(binding && declaration.name.text === "BusLanesSolver")
    assert.notEqual(checker.getSymbolAtLocation(declaration.name), binding)
    const edits: Array<{ start: number; end: number }> = []
    const visit = (node: any): void => {
      if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === binding)
        edits.push({ start: node.getStart(file), end: node.end })
      ts.forEachChild(node, visit)
    }
    visit(file)
    assert.equal(edits.length, 5)
    for (const edit of edits.sort((a, b) => b.start - a.start))
      newBlock = newBlock.slice(0, edit.start) + "_BusLanesSolver" + newBlock.slice(edit.end)
  }
  assert.deepEqual(tokens(newBlock, bundledAliases), tokens(candidate), `Candidate aliasing changed semantics: ${name}`)
  if (JSON.stringify(tokens(candidate)) === JSON.stringify(tokens(baseline))) {
    unchangedDeclarations.push({ name, relative, publishedFragmentSha256: sha(oldBlock), tokenSha256: sha(JSON.stringify(tokens(baseline))) })
    continue
  }
  const characterOffset = start + declaration.getStart(published)
  assert.equal(core.slice(characterOffset, characterOffset + oldBlock.length), oldBlock)
  spans.push({ name, relative, oldBlock, newBlock, characterOffset, byteOffset: Buffer.byteLength(core.slice(0, characterOffset)),
    oldBlockSha256: sha(oldBlock), newBlockSha256: sha(newBlock),
    beforeTokenSha256: sha(JSON.stringify(tokens(baseline))), afterTokenSha256: sha(JSON.stringify(tokens(candidate))) })
}
let candidateCore = core
for (const span of [...spans].sort((a, b) => b.characterOffset - a.characterOffset))
  candidateCore = candidateCore.slice(0, span.characterOffset) + span.newBlock + candidateCore.slice(span.characterOffset + span.oldBlock.length)
const unchangedSegments = []
let previous = 0
for (const span of [...spans].sort((a, b) => a.characterOffset - b.characterOffset)) {
  unchangedSegments.push({ start: previous, end: span.characterOffset, sha256: sha(core.slice(previous, span.characterOffset)) })
  previous = span.characterOffset + span.oldBlock.length
}
unchangedSegments.push({ start: previous, end: core.length, sha256: sha(core.slice(previous)) })
const proof = { passed: true, bun: Bun.version, typescript: ts.version, sourceFiles,
  originalCoreSha256: sha(core), originalBusModuleSha256: sha(bus), candidateCoreSha256: sha(candidateCore),
  bundledAliases, externalAliases, unchangedSegments, unchangedDeclarations, replacedDeclarations: spans.map(({oldBlock, newBlock, ...span}) => span),
  nativeRoutingExecuted: false, moduleImported: false,
  normalization: "Same Bun syntax transformation and parser-aware leaf-token comparison; class constructors move to the front without changing field order, named class bindings are retained, and shorthand properties normalize to explicit equivalent keys. Explicit bundled aliases are checked against lexical bindings. Candidate source keeps local names and maps only the verified imported bindings." }
writeFileSync(join(output, "source-mapping.json"), JSON.stringify(proof, null, 2) + "\n")
writeFileSync(join(output, "overlay-spans.json"), JSON.stringify({ ...proof, spans }, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, sourceFiles, candidateCoreSha256: proof.candidateCoreSha256, declarations: spans.map(span => span.name) }))
