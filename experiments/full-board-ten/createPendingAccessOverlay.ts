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
mkdirSync(output, { recursive: true })
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
const definitions = [
  ["lib/bus-lanes-solver.ts", "BusLanesSolver"],
  ["lib/negotiate-lanes.ts", "negotiateLanes"],
  ["lib/pending-lane-certificates.ts", "pendingPackageExits"],
  ["lib/pending-lane-certificates.ts", "pendingLaneCertificates"],
  ["lib/repair-bus-dogbones.ts", "repairBusDogbones"],
  ["lib/route-backward-package-buses.ts", "routeBackwardPackageBuses"],
  ["lib/route-fresh-shared-buses.ts", "routeFreshSharedBuses"],
  ["lib/route-independent-buses.ts", "routeIndependentBuses"],
  ["lib/route-paired-network.ts", "routePairedNetwork"],
  ["lib/route-shared-layer-buses.ts", "routeSharedLayerBuses"],
  ["lib/negotiate-signal-sites.ts", "negotiateSignalSites"],
  ["lib/route-generated-signal-sites.ts", "routeGeneratedSignalSites"],
  ["lib/route-generated-signal-sites.ts", "completeGeneratedSignalSites"],
  ["lib/route-generated-signal-sites.ts", "negotiateGeneratedSignalSites"],
]

// Every runtime statement outside mapped declarations must remain byte-semantically unchanged.
// This catches unmapped helpers, caches or module side effects in a changed source file.
const sourceScopeQualification = []
for (const relative of new Set(definitions.map(([relative]) => relative))) {
  const before = parse(readFileSync(join(baseRoot, relative), "utf8"))
  const after = parse(readFileSync(join(candidateRoot, relative), "utf8"))
  const mapped = new Set(definitions.filter(([file]) => file === relative).map(([, name]) => name))
  if (relative === "lib/pending-lane-certificates.ts") {
    mapped.add("getPendingExitPathCost")
    mapped.add("getPendingExitCopperCost")
  }
  const unmappedRuntime = (file: any): object[] => file.statements.flatMap((node: any) => {
    if (ts.isImportDeclaration(node) || mapped.has(node.name?.text)) return []
    const runtime = transpiler.transformSync(node.getText(file).replace(/^export\s+/, ""))
    const leafTokens = tokens(runtime)
    return leafTokens.length ? [{ tokens: leafTokens }] : []
  })
  assert.deepEqual(unmappedRuntime(after), unmappedRuntime(before), `Unmapped runtime statement changed: ${relative}`)
  sourceScopeQualification.push({ relative, allUnmappedRuntimeStatementsUnchanged: true, mappedDeclarations: [...mapped] })
}

const spans = []
const unchangedDeclarations = []
const sourceFiles: Record<string, { beforeSha256: string; afterSha256: string }> = {}
for (const [relative, name] of definitions) {
  const beforeText = readFileSync(join(baseRoot, relative), "utf8"), afterText = readFileSync(join(candidateRoot, relative), "utf8")
  sourceFiles[relative] = { beforeSha256: sha(beforeText), afterSha256: sha(afterText) }
  const before = parse(beforeText), after = parse(afterText)
  assert.equal(before.parseDiagnostics.length, 0); assert.equal(after.parseDiagnostics.length, 0)
  const importedNames: string[] = before.statements.filter(ts.isImportDeclaration).flatMap((node: any) => node.importClause?.namedBindings?.elements?.map((item: any) => item.name.text) ?? [])
  const afterImportedNames: string[] = after.statements.filter(ts.isImportDeclaration).flatMap((node: any) => node.importClause?.namedBindings?.elements?.map((item: any) => item.name.text) ?? [])
  const imports = (file: any): Map<string, string[]> => new Map(file.statements.filter(ts.isImportDeclaration).filter((node: any) => !node.importClause?.isTypeOnly).map((node: any) => {
    const clause = node.importClause
    assert(!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
    return [node.moduleSpecifier.text, clause.namedBindings.elements.filter((item: any) => !item.isTypeOnly).map((item: any) => {
      assert(!item.propertyName, "Unexpected named import alias")
      return item.name.text
    }).sort()]
  }))
  const expectedImports = imports(before)
  const addedImports: Record<string, Record<string, string[]>> = {
    "lib/bus-lanes-solver.ts": { "./pending-lane-certificates": ["getPendingExitPathCost"] },
    "lib/negotiate-lanes.ts": { "./pending-lane-certificates": ["getPendingExitPathCost"] },
    "lib/pending-lane-certificates.ts": { "./vector-scene": ["routeCopper", "fixedCopper", "clearanceToCopper"], "./geometry": ["distance", "length"], "./copper-conflict-index": ["CopperConflictIndex"] },
    "lib/negotiate-signal-sites.ts": { "./pending-lane-certificates": ["getPendingExitCopperCost"] },
    "lib/route-generated-signal-sites.ts": { "./pending-lane-certificates": ["pendingPackageExits"], "./vector-scene": ["fixedCopper"] },
  }
  for (const [module, names] of Object.entries(addedImports[relative] ?? {}))
    expectedImports.set(module, [...(expectedImports.get(module) ?? []), ...names].sort())
  const sorted = (value: Map<string, string[]>): Array<[string, string[]]> => [...value].sort(([a], [b]) => a.localeCompare(b))
  assert.deepEqual(sorted(imports(after)), sorted(expectedImports), `Unexpected production import change: ${relative}`)
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
  const localAliases: Record<string, string> = name === "negotiateSignalSites" ? { pools2: "pools", k2: "k" } : name === "routeBackwardPackageBuses" ? { length32: "length" } : name === "routeIndependentBuses" ? { search2: "search", state2: "state", steps2: "steps" } : name === "routeSharedLayerBuses" ? { bounded2: "bounded", reachable2: "reachable", steps2: "steps", reachableLayers2: "reachableLayers" } : {}
  const declarationAliases = { ...bundledAliases, ...localAliases }
  const oldTokens = tokens(transpiler.transformSync(oldBlock), declarationAliases)
  const baseTokens = tokens(baseline)
  assert.equal(oldTokens.length, baseTokens.length, `Token count mismatch: ${name}`)
  const differences = oldTokens.flatMap((token, index) => JSON.stringify(token) === JSON.stringify(baseTokens[index]) ? [] : [{ index, published: token, source: baseTokens[index] }])
  assert.equal(differences.length, 0, `Published source mismatch: ${name}: ${JSON.stringify(differences.slice(0, 20))}`)
  verifyAliasBindings(transpiler.transformSync(oldBlock), declarationAliases, Object.values(localAliases), importedNames)
  verifyAliasBindings(baseline, {}, Object.values(localAliases), importedNames); verifyAliasBindings(candidate, {}, Object.values(localAliases), afterImportedNames)
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
  assert.deepEqual(tokens(newBlock, declarationAliases), tokens(candidate), `Candidate aliasing changed semantics: ${name}`)
  if (JSON.stringify(tokens(candidate)) === JSON.stringify(tokens(baseline))) {
    unchangedDeclarations.push({ name, relative, publishedFragmentSha256: sha(oldBlock), tokenSha256: sha(JSON.stringify(tokens(baseline))) })
    continue
  }
  const characterOffset = start + declaration.getStart(published)
  assert.equal(core.slice(characterOffset, characterOffset + oldBlock.length), oldBlock)
  spans.push({ kind: "replace", name, relative, localAliases, oldBlock, newBlock, characterOffset, byteOffset: Buffer.byteLength(core.slice(0, characterOffset)),
    oldBlockSha256: sha(oldBlock), newBlockSha256: sha(newBlock),
    beforeTokenSha256: sha(JSON.stringify(tokens(baseline))), afterTokenSha256: sha(JSON.stringify(tokens(candidate))) })
}
// Insert both source-qualified helpers at distinct authenticated function boundaries.
const helperRelative = "lib/pending-lane-certificates.ts"
const helperSource = parse(readFileSync(join(candidateRoot, helperRelative), "utf8"))
for (const [helperName, anchorName] of [["getPendingExitPathCost", "pendingPackageExits"], ["getPendingExitCopperCost", "pendingLaneCertificates"]]) {
  const helperDeclarations = helperSource.statements.filter((node: any) => node.name?.text === helperName)
  assert.equal(helperDeclarations.length, 1)
  assert(!new RegExp(`\\b${helperName}\\b`).test(core), "New helper collides with a published Core binding")
  const helper = transpiler.transformSync(helperDeclarations[0].getText(helperSource).replace(/^export\s+/, ""))
  const helperImportedNames: string[] = helperSource.statements.filter(ts.isImportDeclaration).flatMap((node: any) => node.importClause?.namedBindings?.elements?.map((item: any) => item.name.text) ?? [])
  verifyAliasBindings(helper, {}, [], helperImportedNames)
  const helperBlock = helper.replace(/\b(BaseSolver|getCopperLayerNames|getRouteViaSpanLayers|distance|applyToPoint)\b/g, name => externalAliases[name]) + "\n"
  assert.deepEqual(tokens(helperBlock, bundledAliases), tokens(helper))
  verifyAliasBindings(helperBlock, bundledAliases, [], helperImportedNames)
  const insertionAnchor = published.statements.find((node: any) => node.name?.text === anchorName)
  assert(insertionAnchor)
  const helperOffset = start + insertionAnchor.getStart(published)
  spans.push({ kind: "insert", name: helperName, relative: helperRelative, oldBlock: "", newBlock: helperBlock,
    characterOffset: helperOffset, byteOffset: Buffer.byteLength(core.slice(0, helperOffset)),
    oldBlockSha256: sha(""), newBlockSha256: sha(helperBlock), afterTokenSha256: sha(JSON.stringify(tokens(helper))),
    insertionAnchor: anchorName, insertionAnchorSha256: sha(insertionAnchor.getText(published)) })
}
assert.equal(spans.filter(span => span.kind === "replace").length, 14)
assert.equal(unchangedDeclarations.length, 0)
assert.equal(spans.filter(span => span.kind === "insert").length, 2)
const sourceNegotiationBefore = parse(readFileSync(join(baseRoot, "lib/negotiate-lanes.ts"), "utf8"))
const sourceNegotiationAfter = parse(readFileSync(join(candidateRoot, "lib/negotiate-lanes.ts"), "utf8"))
const parametersBefore = sourceNegotiationBefore.statements.find((node: any) => node.name?.text === "negotiateLanes").parameters
const parametersAfter = sourceNegotiationAfter.statements.find((node: any) => node.name?.text === "negotiateLanes").parameters
assert.equal(parametersAfter.length, 1)
assert(ts.isObjectBindingPattern(parametersAfter[0].name))
const parameterNames: string[] = parametersBefore.map((node: any) => node.name.text)
const beforeDefaults = new Map<string, string>(parametersBefore.map((node: any) => [node.name.text, node.initializer?.getText(sourceNegotiationBefore) ?? "undefined"]))
const afterDefaults = new Map<string, string>(parametersAfter[0].name.elements.map((node: any) => [node.name.text, node.initializer?.getText(sourceNegotiationAfter) ?? "undefined"]))
assert.deepEqual([...afterDefaults.keys()], [...parameterNames, "pendingExits"])
const expressionTokens = (text: string): unknown => tokens(transpiler.transformSync(`const value = (${text})`))
for (const name of parameterNames) assert.deepEqual(expressionTokens(beforeDefaults.get(name)!), expressionTokens(afterDefaults.get(name)!))
assert.deepEqual(expressionTokens(afterDefaults.get("pendingExits")!), expressionTokens("[]"))
const callsiteQualification = []
for (const relative of Object.keys(sourceFiles)) {
  const before = parse(readFileSync(join(baseRoot, relative), "utf8")), after = parse(readFileSync(join(candidateRoot, relative), "utf8"))
  const collectCalls = (file: any): any[] => {
    const result: any[] = []
    const visit = (node: any): void => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "negotiateLanes") result.push(node); ts.forEachChild(node, visit) }
    visit(file)
    return result
  }
  const oldCalls = collectCalls(before), newCalls = collectCalls(after)
  assert.equal(oldCalls.length, newCalls.length)
  for (let index = 0; index < oldCalls.length; index++) {
    const oldCall = oldCalls[index], newCall = newCalls[index]
    assert.equal(newCall.arguments.length, 1)
    assert(ts.isObjectLiteralExpression(newCall.arguments[0]))
    const options = new Map<string, string>(newCall.arguments[0].properties.map((node: any) => {
      assert(ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
      return [node.name.text, ts.isShorthandPropertyAssignment(node) ? node.name.getText(after) : node.initializer.getText(after)]
    }))
    assert([...options.keys()].every(name => afterDefaults.has(name)))
    for (let parameterIndex = 0; parameterIndex < parameterNames.length; parameterIndex++) {
      const name = parameterNames[parameterIndex], oldExpression = oldCall.arguments[parameterIndex]?.getText(before)
      const expected = oldExpression === undefined || oldExpression === "undefined" ? beforeDefaults.get(name)! : oldExpression
      assert.deepEqual(expressionTokens(options.get(name) ?? afterDefaults.get(name)!), expressionTokens(expected), `Existing call argument changed: ${relative}/${name}`)
    }
    const expectedPending = relative === "lib/bus-lanes-solver.ts" ? "this.pendingExits" : "[]"
    assert.deepEqual(expressionTokens(options.get("pendingExits") ?? afterDefaults.get("pendingExits")!), expressionTokens(expectedPending))
    const order = [...options.keys()].map(name => [...parameterNames, "pendingExits"].indexOf(name))
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
    callsiteQualification.push({ relative, index, existingArgumentsAndDefaultsPreserved: true, lazyCallbacksPreserved: true, evaluationOrderPreserved: true, pendingExits: expectedPending })
  }
}
assert.equal(callsiteQualification.length, 7)
const orderedSpans = [...spans].sort((a, b) => a.characterOffset - b.characterOffset || (a.kind === "insert" ? -1 : 1))
let previousEnd = start
for (const span of orderedSpans) {
  assert(span.characterOffset >= previousEnd && span.characterOffset + span.oldBlock.length <= end)
  previousEnd = span.characterOffset + span.oldBlock.length
}
let candidateCore = core
for (const span of [...spans].sort((a, b) => b.characterOffset - a.characterOffset || (a.kind === "replace" ? -1 : 1)))
  candidateCore = candidateCore.slice(0, span.characterOffset) + span.newBlock + candidateCore.slice(span.characterOffset + span.oldBlock.length)
const candidateBus = candidateCore.slice(start, end + candidateCore.length - core.length)
const candidateParsed = parse(candidateBus)
assert.equal(candidateParsed.parseDiagnostics.length, 0)
for (const name of ["getPendingExitPathCost", "getPendingExitCopperCost"]) assert.equal(candidateParsed.statements.filter((node: any) => node.name?.text === name).length, 1)
function collectNegotiationCalls(file: any): any[] {
  const result: any[] = []
  const visit = (node: any): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "negotiateLanes") result.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result
}
const publishedCalls = collectNegotiationCalls(published), candidateCalls = collectNegotiationCalls(candidateParsed)
assert.equal(publishedCalls.length, 7)
assert.equal(candidateCalls.length, 7)
assert(candidateCalls.every(call => call.arguments.length === 1 && ts.isObjectLiteralExpression(call.arguments[0])))
const publishedCallCoverage = { publishedCallCount: publishedCalls.length, candidateCallCount: candidateCalls.length, allCandidateCallsUseObjectArgument: true }
const unchangedSegments = []
let previous = 0
for (const span of orderedSpans) {
  unchangedSegments.push({ start: previous, end: span.characterOffset, sha256: sha(core.slice(previous, span.characterOffset)) })
  previous = span.characterOffset + span.oldBlock.length
}
unchangedSegments.push({ start: previous, end: core.length, sha256: sha(core.slice(previous)) })
const proof = { passed: true, schemaVersion: 2, sourceCandidateCommit, sourceCommitProvenance: "Revision supplied by the controller; exact source patch and before/after file hashes are authenticated by its installer.", bun: Bun.version, typescript: ts.version, sourceFiles, sourceScopeQualification, callsiteQualification, publishedCallCoverage,
  originalCoreSha256: sha(core), originalBusModuleSha256: sha(bus), candidateCoreSha256: sha(candidateCore),
  bundledAliases, externalAliases, unchangedSegments, unchangedDeclarations, replacedDeclarations: spans.filter(span => span.kind === "replace").map(({oldBlock, newBlock, ...span}) => span),
  insertedDeclarations: spans.filter(span => span.kind === "insert").map(({oldBlock, newBlock, ...span}) => span),
  nativeRoutingExecuted: false, moduleImported: false,
  normalization: "Same Bun syntax transformation and parser-aware leaf-token comparison; class constructors move to the front without changing field order, named class bindings are retained, and shorthand properties and binding patterns normalize to explicit equivalent keys while retaining default initializers. Explicit bundled aliases are checked against lexical bindings. Candidate source keeps local names and maps only the five verified imported aliases. Fourteen existing declarations are replaced and two source-qualified helpers inserted at authenticated function boundaries after full-Core name-collision checks. All seven negotiateLanes call sites preserve existing arguments/defaults. Generated-site calls pass pending guides through the reviewed source fragments; active future branch certificates and whole-copper costs change routing choices. Unmapped source runtime statements and Core bytes outside reviewed spans remain unchanged. No native routing equivalence or completion benefit is claimed." }
writeFileSync(join(output, "source-mapping.json"), JSON.stringify(proof, null, 2) + "\n")
writeFileSync(join(output, "overlay-spans.json"), JSON.stringify({ ...proof, spans }, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, sourceFiles, candidateCoreSha256: proof.candidateCoreSha256, declarations: spans.map(span => span.name) }))
