import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { gunzipSync } from "node:zlib"

// Static source qualification only. The published bundle is parsed, never imported.
const [a03Root, arRoot, entryPath, mapPath, tsPath, outDir, draftOption] = process.argv.slice(2)
const allowDraft = draftOption === "--allow-draft"
assert(draftOption === undefined || allowDraft)
assert(a03Root && arRoot && entryPath && mapPath && tsPath && outDir)
assert.equal(Bun.version, "1.4.3")
const require = createRequire(resolve(tsPath))
const ts = require(resolve(tsPath)), terser = require("terser")
assert.equal(ts.version, "5.9.3")
assert.equal(require("terser/package.json").version, "5.51.2")
const sha = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex")
const read = (file: string): string => (file.endsWith(".gz") ? gunzipSync(readFileSync(file)) : readFileSync(file)).toString()
const original = read(entryPath), sourceMapText = read(mapPath), sourceMap = JSON.parse(sourceMapText)
assert.equal(sha(original), "5695c6361c0f7a7dc26ddd1b9264b8a8c122e5f7b9610cf24c6af3b99c545df1")
assert.equal(sha(sourceMapText), "9edff1c06b9a33231e581e2aae1115cfd96213f28df65eb3d56d7d78b078241d")
const handoffPath = join(outDir, "mapping-source-handoff.json"), handoffText = readFileSync(handoffPath, "utf8"), handoff = JSON.parse(handoffText)
const git = (root: string, args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } })
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", treeShaking: false })
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
const sourceClass = (file: any, name: string): any => {
  const found = file.statements.filter((node: any) => ts.isClassDeclaration(node) && node.name?.text === name)
  assert.equal(found.length, 1, `Source class ${name}`)
  return found[0]
}
const member = (cls: any, name: string): any => {
  const found = cls.members.filter((node: any) => name === "constructor" ? ts.isConstructorDeclaration(node) : node.name?.getText() === name)
  assert.equal(found.length, 1, `Class member ${name}`)
  return found[0]
}
const variable = (file: any, name: string): any => {
  const found: any[] = []
  for (const statement of file.statements) if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(file) === name) found.push(declaration)
  assert.equal(found.length, 1, `Top-level variable ${name}`)
  return found[0]
}
const publishedFile = parse(original)
const publishedClass = (name: string, solverName?: string): any => {
  const node = variable(publishedFile, name)
  assert(ts.isClassExpression(node.initializer))
  if (solverName) assert(member(node.initializer, "getSolverName").getText(publishedFile).includes(JSON.stringify(solverName)))
  return node.initializer
}
const classes: Record<string, any> = {
  HighDensitySolverA03: publishedClass("Vi", "HighDensitySolverA03"),
  HighDensitySolver: publishedClass("UB", "HighDensitySolver"),
  PortfolioSingleIntraNodeSolver: publishedClass("OB", "PortfolioSingleIntraNodeSolver"),
  Pipeline9RegionalFallbackSolver: publishedClass("Sre", "Pipeline9RegionalFallbackSolver"),
}
const predicateCandidates: any[] = []
for (const statement of publishedFile.statements) if (ts.isVariableStatement(statement))
  for (const declaration of statement.declarationList.declarations) {
    const initial = declaration.initializer
    if (!initial || !ts.isArrowFunction(initial) || initial.parameters.length !== 1) continue
    const parameter = initial.parameters[0].name
    if (!ts.isObjectBindingPattern(parameter)) continue
    const names = parameter.elements.map((item: any) => (item.propertyName ?? item.name).getText(publishedFile)).sort()
    if (JSON.stringify(names) === JSON.stringify(["routes", "movablePreloadedConnectionNames", "boardObstacles", "connMap", "layerCount", "viaToPadClearance", "allowBlindAndBuriedVias"].sort())) predicateCandidates.push(declaration)
  }
assert.equal(predicateCandidates.length, 1)
const publishedPredicate = predicateCandidates[0]

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
const canonical = async (text: string, isVariable = false, prelude = ""): Promise<string> => {
  const wrapped = isVariable ? `export const Qualified = ${text};` : `export class Qualified extends QualifiedBase { ${text} }`
  const result = await terser.minify(prelude + "\n" + wrapped, { module: true, compress: { passes: 3 }, mangle: { toplevel: true, nth_identifier: { get: (index: number): string => `binding${index}` } } })
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
function mergeAliases(target: Record<string, string>, added: Record<string, string>): void {
  for (const [name, value] of Object.entries(added)) {
    assert(!target[name] || target[name] === value, `Conflicting published binding ${name}`)
    target[name] = value
  }
}
function compileMember(text: string): string {
  const emitted = parse(transpiler.transformSync(`class Qualified extends QualifiedBase { ${text} }`))
  return member(sourceClass(emitted, "Qualified"), text.trimStart().startsWith("constructor") ? "constructor" : sourceClass(emitted, "Qualified").members[0].name.text).getText(emitted)
}
function renameNode(record: any, node: any, aliases: Record<string, string>): string {
  const globalSymbols = new Map<any, string>()
  const visitBinding = (current: any): void => {
    if (ts.isIdentifier(current) && aliases[current.text] && !isPropertyName(current)) {
      const symbol = record.checker.getSymbolAtLocation(current)
      if (symbol?.declarations?.some((decl: any) =>
        ts.isImportSpecifier(decl) || ts.isImportClause(decl) ||
        ((ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl)) && ts.isSourceFile(decl.parent)) ||
        (ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent) && ts.isVariableStatement(decl.parent.parent) && ts.isSourceFile(decl.parent.parent.parent)))) globalSymbols.set(symbol, aliases[current.text])
    }
    ts.forEachChild(current, visitBinding)
  }
  visitBinding(record.afterFile)
  const transformed = ts.transform(node, [(context: any) => {
    const visit = (current: any): any => {
      if (ts.isIdentifier(current) && !isPropertyName(current)) {
        const replacement = globalSymbols.get(record.checker.getSymbolAtLocation(current))
        if (replacement) return ts.factory.createIdentifier(replacement)
      }
      return ts.visitEachChild(current, visit, context)
    }
    return visit
  }])
  const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, transformed.transformed[0], record.afterFile)
  transformed.dispose()
  return printed
}

const repositories = [
  { repository: "tscircuit/high-density-a01", root: a03Root, sourceBaseCommit: "85ee23a25403bbb79be14b6d0783e592928a85a0", publishedBaseCommit: "85ee23a25403bbb79be14b6d0783e592928a85a0", productionPatchFile: "a03-via-gate-production.patch", changedFiles: [] as any[] },
  { repository: "tscircuit/tscircuit-autorouter", root: arRoot, sourceBaseCommit: "c0dcc07ae48b17296a1dc73678e258de62ca8de3", publishedBaseCommit: "c0dcc07ae48b17296a1dc73678e258de62ca8de3", productionPatchFile: "autorouter-a03-via-gate-production.patch", changedFiles: [] as any[] },
]
const definitions = [
  { repository: repositories[0], relative: "lib/HighDensitySolverA03/HighDensitySolverA03.ts", sourceIndex: 147, className: "HighDensitySolverA03", methods: ["constructor", "getConstructorParams", "stepOnce"], insertedFieldAfter: "initialPenaltyFn" },
  { repository: repositories[1], relative: "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver.ts", sourceIndex: 1580, className: "Pipeline9RegionalFallbackSolver", methods: ["constructor"], replacedVariable: "hasPreloadedViaToBoardObstacleConflict", insertedVariable: "hasViaToBoardObstacleConflict" },
  { repository: repositories[1], relative: "lib/solvers/HighDensitySolver/HighDensitySolver.ts", sourceIndex: 1081, className: "HighDensitySolver", methods: ["constructor", "_step"], insertedFieldAfter: "growShrinkSolutionValidator" },
  { repository: repositories[1], relative: "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts", sourceIndex: 1077, className: "PortfolioSingleIntraNodeSolver", methods: ["generateSolver"] },
]
const compilerNormalizations: any[] = []
function expandA03EndpointReadsForComparison(compiled: string): string {
  const file = parse(`class Qualified { ${compiled} }`), matches: any[] = []
  const visit = (node: any): void => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) &&
      node.name.elements.some((item: any) => (item.propertyName ?? item.name).getText(file) === "endZ")) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(matches.length, 1, "A03 endpoint-read normalization requires one exact binding")
  const declaration = matches[0], elements = declaration.name.elements
  assert.equal(declaration.initializer?.getText(file), "seg")
  assert.equal(elements.length, 2)
  assert.deepEqual(elements.map((item: any) => (item.propertyName ?? item.name).getText(file)), ["endZ", "endCellId"])
  for (const item of elements) {
    assert(ts.isIdentifier(item.name) && !item.initializer && !item.dotDotDotToken)
    assert.equal(item.name.text, (item.propertyName ?? item.name).getText(file))
  }
  assert(declaration.parent.flags & ts.NodeFlags.Const)
  const replacement = elements.map((item: any) => `${item.name.text} = seg.${item.name.text}`).join(", ")
  const text = file.text.slice(0, declaration.getStart(file)) + replacement + file.text.slice(declaration.end)
  const normalizedFile = parse(text)
  return member(sourceClass(normalizedFile, "Qualified"), "stepOnce").getText(normalizedFile)
}
const records: any[] = []
for (const definition of definitions) {
  const before = git(definition.repository.root, ["show", `${definition.repository.sourceBaseCommit}:${definition.relative}`])
  const after = readFileSync(join(definition.repository.root, definition.relative), "utf8")
  assert.equal(before, sourceMap.sourcesContent[definition.sourceIndex], `Published source differs: ${definition.relative}`)
  const sourceHandoff = handoff.repositories.find((row: any) => row.baseCommit === definition.repository.sourceBaseCommit)
  assert(sourceHandoff && (sourceHandoff.productionClean || allowDraft))
  assert.equal(git(definition.repository.root, ["rev-parse", "HEAD"]).trim(), sourceHandoff.candidateCommit ?? sourceHandoff.baseCommit)
  if (!allowDraft) assert.equal(git(definition.repository.root, ["status", "--porcelain", "--", definition.relative]).trim(), "")
  assert.equal(sha(after), sourceHandoff.files.find((row: any) => row.path === definition.relative && row.production)?.sha256)
  const checked = programFor(after)
  const record: any = { ...definition, before, after, beforeFile: parse(before), afterFile: checked.file, checker: checked.checker, aliases: {}, qualifications: [] }
  record.baseClass = sourceClass(record.beforeFile, definition.className)
  record.candidateClass = sourceClass(record.afterFile, definition.className)
  definition.repository.changedFiles.push({ relative: definition.relative, beforeSha256: sha(before), afterSha256: sha(after) })
  const normalizeRuntime = (text: string, candidate: boolean): string => {
    const file = parse(transpiler.transformSync(text)), cls = sourceClass(file, definition.className)
    const removals = definition.methods.map((name) => member(cls, name))
    if (candidate && definition.insertedFieldAfter) removals.push(member(cls, "isViaAllowed"))
    if (definition.replacedVariable) {
      const declaration = variable(file, definition.replacedVariable)
      removals.push(declaration.parent.parent)
    }
    if (candidate && definition.insertedVariable) removals.push(variable(file, definition.insertedVariable).parent.parent)
    let remaining = file.text
    for (const node of [...new Set(removals)].sort((a: any, b: any) => b.getStart(file) - a.getStart(file))) remaining = remaining.slice(0, node.getStart(file)) + remaining.slice(node.end)
    const remainingFile = parse(remaining), tokens: any[] = []
    const visit = (node: any): void => {
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return
      const children = node.getChildren(remainingFile)
      if (children.length) children.forEach(visit)
      else if (node.getText(remainingFile)) tokens.push([node.kind, node.getText(remainingFile)])
    }
    visit(remainingFile)
    return JSON.stringify(tokens)
  }
  const baseOutside = normalizeRuntime(before, false), candidateOutside = normalizeRuntime(after, true)
  if (baseOutside !== candidateOutside) {
    const left = JSON.parse(baseOutside), right = JSON.parse(candidateOutside)
    const index = left.findIndex((value: any, index: number) => JSON.stringify(value) !== JSON.stringify(right[index]))
    console.log(JSON.stringify({ scopeMismatch: definition.relative, index, before: left.slice(Math.max(0, index - 4), index + 12), after: right.slice(Math.max(0, index - 4), index + 12) }))
  }
  assert(baseOutside === candidateOutside, `Unrelated runtime source changed: ${definition.relative}`)
  for (const name of definition.methods) {
    const base = compileMember(member(record.baseClass, name).getText(record.beforeFile))
    const published = member(classes[definition.className], name).getText(publishedFile)
    let constantPrelude = ""
    if (definition.className === "HighDensitySolver" && name === "constructor") {
      const constantSource = parse(sourceMap.sourcesContent[1080])
      const constant = variable(constantSource, "DEFAULT_MAX_GROWTH_ATTEMPTS")
      assert.equal(constant.initializer.getText(constantSource), "3")
      constantPrelude = transpiler.transformSync(`const ${constant.getText(constantSource)};`)
    }
    let comparisonBase = base
    if (definition.className === "HighDensitySolverA03" && name === "stepOnce") {
      const sourceText = member(record.baseClass, name).getText(record.beforeFile)
      assert(sourceText.includes("const endZ = seg.endZ") && sourceText.includes("const endCellId = seg.endCellId"))
      comparisonBase = expandA03EndpointReadsForComparison(base)
      let invalidShapeRejected = false
      try { expandA03EndpointReadsForComparison(base.replace("{ endZ, endCellId }", "{ endZ, endCellId, unexpected }")) } catch { invalidShapeRejected = true }
      assert(invalidShapeRejected, "Normalization must reject any additional property read")
      const evidence = { name: "A03.stepOnce adjacent endpoint reads", comparisonOnly: true,
        sourceSha256: sha(sourceText), compiledBeforeSha256: sha(base), normalizedSha256: sha(comparisonBase),
        rule: "Expand only const { endZ, endCellId } = seg into the original source's two ordered reads from the same local const; no defaults, rest, alias, extra property or effectful initializer accepted",
        extraPropertyRejected: invalidShapeRejected }
      compilerNormalizations.push(evidence)
      writeFileSync(join(outDir, "a03-stepOnce-source.ts"), sourceText)
      writeFileSync(join(outDir, "a03-stepOnce-compiled.js"), base)
      writeFileSync(join(outDir, "a03-stepOnce-published.js"), published)
      writeFileSync(join(outDir, "a03-stepOnce-normalized-comparison.js"), comparisonBase)
    }
    const baseCanonical = await canonical(comparisonBase, false, constantPrelude), publishedCanonical = await canonical(published)
    const aliases = deriveAliases(baseCanonical, publishedCanonical, `${definition.className}.${name}`)
    mergeAliases(record.aliases, aliases)
    record.qualifications.push({ name, baseCanonical, publishedCanonical, aliases, constantPrelude })
  }
  if (definition.replacedVariable) {
    const helpers = ["getPointToObstacleDistance", "getObstacleZLayers", "isPipeline9ObstacleConnectedToRoute"]
    record.inlinedHelpers = helpers
    const inlineCallees: any[] = []
    const visitCalls = (node: any): void => {
      if (ts.isCallExpression(node)) {
        let expression = node.expression
        while (ts.isParenthesizedExpression(expression)) expression = expression.expression
        if (ts.isArrowFunction(expression)) inlineCallees.push(expression)
      }
      ts.forEachChild(node, visitCalls)
    }
    visitCalls(publishedPredicate.initializer)
    assert.equal(inlineCallees.length, 3, "Expected exactly three immediate published helper calls")
    const helperNames = new Map<any, string>()
    record.inlinedHelperQualification = []
    for (const inline of inlineCallees) {
      const text = inline.getText(publishedFile)
      const name = text.includes("__zLayers") ? "getObstacleZLayers" : text.includes(".shape") ? "getPointToObstacleDistance" : "isPipeline9ObstacleConnectedToRoute"
      assert(![...helperNames.values()].includes(name))
      const compiledHelper = parse(transpiler.transformSync(`const ${variable(record.beforeFile, name).getText(record.beforeFile)};`))
      const helperBaseCanonical = await canonical(variable(compiledHelper, name).initializer.getText(compiledHelper), true)
      const helperPublishedCanonical = await canonical(text, true)
      const aliases = deriveAliases(helperBaseCanonical, helperPublishedCanonical, `inlined ${name}`)
      mergeAliases(record.aliases, aliases)
      helperNames.set(inline, name)
      record.inlinedHelperQualification.push({ name, publishedInlineSha256: sha(text), compiledBaseCanonicalSha256: sha(helperBaseCanonical), publishedCanonicalSha256: sha(helperPublishedCanonical), aliases, compiledBaseEquivalent: true })
    }
    const normalized = ts.transform(publishedPredicate.initializer, [(context: any) => {
      const visit = (node: any): any => helperNames.has(node) ? ts.factory.createIdentifier(helperNames.get(node)!) : ts.visitEachChild(node, visit, context)
      return visit
    }])
    const normalizedPublished = ts.createPrinter().printNode(ts.EmitHint.Expression, normalized.transformed[0], publishedFile)
    normalized.dispose()
    const emitted = parse(transpiler.transformSync(variable(record.beforeFile, definition.replacedVariable).parent.parent.getText(record.beforeFile)))
    const baseCanonical = await canonical(variable(emitted, definition.replacedVariable).initializer.getText(emitted), true)
    const publishedCanonical = await canonical(normalizedPublished, true)
    const aliases = deriveAliases(baseCanonical, publishedCanonical, definition.replacedVariable)
    mergeAliases(record.aliases, aliases)
    record.aliases[definition.replacedVariable] = publishedPredicate.name.text
    record.qualifications.push({ name: definition.replacedVariable, baseCanonical, publishedCanonical, aliases })
  }
  if (definition.className === "HighDensitySolverA03") {
    const baseCanonical = await canonical(compileMember(member(record.baseClass, "getOutput").getText(record.beforeFile)))
    const publishedCanonical = await canonical(member(classes.HighDensitySolverA03, "getOutput").getText(publishedFile))
    mergeAliases(record.aliases, deriveAliases(baseCanonical, publishedCanonical, "unchanged A03.getOutput"))
    assert.equal(record.aliases.applyAffineTransformToPoint, "Ii")
    const affine = publishedFile.statements.filter((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "Ii")
    assert.equal(affine.length, 1)
    assert.equal(sha(affine[0].getText(publishedFile)), "3f4b93b223501b45f28f3bacd7cad3f693cfd1cca6f0873a13d11a25d47607ac")
  }
  records.push(record)
}

const spans: any[] = []
function span(record: any, name: string, oldNode: any, replacementText: string, qualification: any): void {
  const startCharacter = oldNode.getStart(publishedFile), endCharacter = oldNode.end
  const originalText = original.slice(startCharacter, endCharacter)
  spans.push({ kind: "replace", name, sourceRepository: record.repository.repository, sourceRelative: record.relative,
    startCharacter, endCharacter, startByte: Buffer.byteLength(original.slice(0, startCharacter)), endByte: Buffer.byteLength(original.slice(0, endCharacter)),
    originalText, replacementText, originalSha256: sha(originalText), replacementSha256: sha(replacementText),
    compiledBaseEquivalent: true, baseCanonicalSha256: sha(qualification.publishedCanonical), aliases: qualification.aliases })
}
function insertion(record: any, name: string, position: number, replacementText: string): void {
  spans.push({ kind: "insert", name, sourceRepository: record.repository.repository, sourceRelative: record.relative,
    startCharacter: position, endCharacter: position, startByte: Buffer.byteLength(original.slice(0, position)), endByte: Buffer.byteLength(original.slice(0, position)),
    originalText: "", replacementText, originalSha256: sha(""), replacementSha256: sha(replacementText), compiledBaseEquivalent: null })
}
for (const record of records) {
  for (const name of record.methods) {
    const source = renameNode(record, member(record.candidateClass, name), record.aliases)
    let replacement = compileMember(source)
    const qualification = record.qualifications.find((row: any) => row.name === name)
    if (qualification.constantPrelude) {
      const foldedFile = parse(await canonical(replacement, false, qualification.constantPrelude))
      replacement = member(sourceClass(foldedFile, "Qualified"), name).getText(foldedFile)
    }
    assert.notEqual(await canonical(replacement), qualification.publishedCanonical, `No actual change: ${record.className}.${name}`)
    span(record, `${record.className}.${name}`, member(classes[record.className], name), replacement, qualification)
  }
  if (record.insertedFieldAfter) {
    const field = compileMember(member(record.candidateClass, "isViaAllowed").getText(record.afterFile))
    assert.equal(field, "isViaAllowed;")
    insertion(record, `${record.className}.isViaAllowed`, member(classes[record.className], record.insertedFieldAfter).end, field)
  }
  if (record.replacedVariable) {
    const declaration = variable(record.afterFile, record.replacedVariable)
    const transformed = renameNode(record, declaration.parent.parent, record.aliases)
    const emitted = parse(transpiler.transformSync(transformed))
    const replacement = variable(emitted, publishedPredicate.name.text).getText(emitted)
    span(record, record.replacedVariable, publishedPredicate, replacement, record.qualifications.find((row: any) => row.name === record.replacedVariable))
  }
  if (record.insertedVariable) {
    assert(!original.includes(record.insertedVariable), "New helper name already exists in published module")
    const declaration = variable(record.afterFile, record.insertedVariable)
    const candidateHelpers = record.inlinedHelpers.map((name: string) => {
      const transformed = renameNode(record, variable(record.afterFile, name), record.aliases)
      return `const ${transformed};`
    }).join("\n")
    const emitted = parse(transpiler.transformSync(renameNode(record, declaration.parent.parent, record.aliases)))
    const helperCluster = await canonical(variable(emitted, record.insertedVariable).initializer.getText(emitted), true, transpiler.transformSync(candidateHelpers))
    const helperFile = parse(helperCluster)
    assert.equal(helperFile.statements.length, 1, "Shared helper compilation must inline all three source-local dependencies")
    const helperInitializer = variable(helperFile, "Qualified").initializer.getText(helperFile)
    insertion(record, record.insertedVariable, publishedPredicate.getStart(publishedFile), `${record.insertedVariable}=${helperInitializer},`)
  }
}
spans.sort((left, right) => left.startCharacter - right.startCharacter || (left.kind === "insert" ? -1 : 1))
assert.equal(spans.filter((item) => item.kind === "replace").length, 8)
assert.equal(spans.filter((item) => item.kind === "insert").length, 3)
let cursor = 0, candidate = ""
const unchangedSegments: any[] = []
for (const item of spans) {
  assert(item.startCharacter >= cursor)
  const unchanged = original.slice(cursor, item.startCharacter)
  if (unchanged.length) unchangedSegments.push({ startByte: Buffer.byteLength(original.slice(0, cursor)), endByte: item.startByte,
    candidateStartByte: Buffer.byteLength(candidate), candidateEndByte: Buffer.byteLength(candidate + unchanged), sha256: sha(unchanged) })
  candidate += unchanged + item.replacementText
  cursor = item.endCharacter
}
const tail = original.slice(cursor)
if (tail.length) unchangedSegments.push({ startByte: Buffer.byteLength(original.slice(0, cursor)), endByte: Buffer.byteLength(original),
  candidateStartByte: Buffer.byteLength(candidate), candidateEndByte: Buffer.byteLength(candidate + tail), sha256: sha(tail) })
candidate += tail
parse(candidate)
for (const segment of unchangedSegments) assert.equal(sha(Buffer.from(candidate).subarray(segment.candidateStartByte, segment.candidateEndByte)), segment.sha256)
mkdirSync(join(outDir, "dist"), { recursive: true })
const source = { repositories: repositories.map(({ root, ...repository }) => {
  const files = repository.changedFiles.map((row: any) => row.relative)
  const productionPatch = git(root, ["diff", "--binary", repository.sourceBaseCommit, "--", ...files])
  const candidateCommit = git(root, ["status", "--porcelain", "--", ...files]).trim() ? null : git(root, ["rev-parse", "HEAD"]).trim()
  assert(productionPatch.length > 0)
  const sourceHandoff = handoff.repositories.find((row: any) => row.baseCommit === repository.sourceBaseCommit)
  assert.equal(candidateCommit, sourceHandoff.candidateCommit)
  assert.equal(sha(productionPatch), sourceHandoff.patches.production.sha256)
  writeFileSync(join(outDir, repository.productionPatchFile), productionPatch)
  return { ...repository, candidateCommit, productionPatchSha256: sha(productionPatch) }
}) }
const mapping = { schemaVersion: 2, passed: true, sourceFrozen: !allowDraft, originalAutorouterSha256: sha(original), candidateAutorouterSha256: sha(candidate), sourceMapSha256: sha(sourceMapText), source,
  spans, unchangedSegments, qualification: { allOutsideBytesUnchanged: true, unrelatedSourceRuntimeUnchanged: true,
    compiledBaseEquivalent: true, sourceMapGeneratedOffsetsUsed: false,
    canonicalizer: "Terser5.51.2 three compression passes and deterministic lexical names; differing free bindings mapped bijectively; properties and local bindings must match exactly",
    sourceAliases: records.map((record) => ({ relative: record.relative, aliases: record.aliases })),
    inlinedHelperEquivalence: records.flatMap((record) => record.inlinedHelperQualification ?? []),
    compilerNormalizations,
    bun: Bun.version, typescript: ts.version, terser: require("terser/package.json").version },
  sourceHandoffSha256: sha(handoffText), mapperSha256: sha(readFileSync(import.meta.path)), moduleImported: false, nativeRoutingExecuted: false }
writeFileSync(join(outDir, "dist/a03-via-gate-candidate.js"), candidate)
writeFileSync(join(outDir, "a03-via-gate-source-mapping.json"), JSON.stringify(mapping, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, replacements: 8, insertions: 3, candidateAutorouterSha256: mapping.candidateAutorouterSha256, source, nativeRoutingExecuted: false }))
