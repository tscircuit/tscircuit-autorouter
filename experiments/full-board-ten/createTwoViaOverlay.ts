import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { gunzipSync } from "node:zlib"

// Static source qualification only. The published bundle is parsed, never imported.
const [tinyRoot, arRoot, entryPath, mapPath, tsPath, outDir, draftOption] = process.argv.slice(2)
const allowDraft = draftOption === "--allow-draft"
assert(draftOption === undefined || allowDraft)
assert(tinyRoot && arRoot && entryPath && mapPath && tsPath && outDir)
assert.equal(Bun.version, "1.3.1")
const require = createRequire(resolve(tsPath))
const ts = require(resolve(tsPath)), terser = require("terser")
assert.equal(ts.version, "5.9.3")
assert.equal(require("terser/package.json").version, "5.51.2")
const sha = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex")
const read = (file: string): string => (file.endsWith(".gz") ? gunzipSync(readFileSync(file)) : readFileSync(file)).toString()
const original = read(entryPath), sourceMapText = read(mapPath), sourceMap = JSON.parse(sourceMapText)
assert.equal(sha(original), "44e2cc5a759e11f3982a876733d0f224dcb901c0ac0840e2ff1ec5be434a4285")
assert.equal(sha(sourceMapText), "aec2fc7d644bba32defd9e4fa7ec957c78ffdeb37fbfe83d0de780bd5311d5f7")
const handoffPath = join(outDir, "mapping-source-handoff.json"), handoffText = readFileSync(handoffPath, "utf8"), handoff = JSON.parse(handoffText)
mkdirSync(outDir, { recursive: true })
const git = (root: string, args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } })
// TypeScript type erasure preserves the source's explicit `new Error` syntax;
// Bun's transpiler additionally rewrites that expression during type erasure.
const transpiler = { transformSync: (text: string): string => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true },
}).outputText }
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


const tinyBase = "f1fe8edcfb3dfde8fd644d09d81bad18743144b3"
const arBase = "a4f2778cb40bbc9c147b95a4e48ef0b32f1dd08f"
const repositories: any[] = [
  { repository: "tscircuit/tiny-hypergraph", root: tinyRoot, sourceBaseCommit: tinyBase, publishedBaseCommit: tinyBase, productionPatchFile: "tiny-two-via-production.patch", changedFiles: [] },
  { repository: "tscircuit/tscircuit-autorouter", root: arRoot, sourceBaseCommit: arBase, publishedBaseCommit: arBase, productionPatchFile: "autorouter-two-via-production.patch", changedFiles: [] },
]
const definitions: any[] = [
  { repository: repositories[0], relative: "lib/core.ts", sourcePath: "../node_modules/tiny-hypergraph/lib/core.ts",
    variables: [
      { name: "applyTinyHyperGraphSolverOptions", published: "IQ" },
      { name: "getTinyHyperGraphSolverOptions", published: "SQ" },
    ],
    classes: [
      { name: "TinyHyperGraphSolver", published: "PQ", members: ["_step", "expandRegionalHopFrontier", "computeG"], insertedMembers: ["minThroughViaCenterDistance", "isLayerTransitionBlocked"] },
      { name: "GreedyFinalRouteSolver", extendsPublished: "PQ", members: ["computeG"] },
    ],
  },
  { repository: repositories[0], relative: "lib/prepared/DenseRoutingWorkspace.ts", sourcePath: "../node_modules/tiny-hypergraph/lib/prepared/DenseRoutingWorkspace.ts",
    classes: [{ name: "DenseRoutingWorkspace", published: "XQ", members: ["expand"] }],
  },
  { repository: repositories[1], relative: "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts", sourcePath: "../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts",
    variables: [
      { name: "getTinyHyperGraphSolveGraphOptions", published: "g0" },
      { name: "getTinyHyperGraphSectionSolverOptions", published: "f0" },
    ],
    localHelpers: ["getTinyHyperGraphPipelineInput"],
    classes: [{ name: "TinyHypergraphPortPointPathingSolver", solverIdentity: true, members: ["constructor"], helpers: ["getTinyRouteConnectionsOrThrow", "capturePreloadedTraceSegmentBaseline", "getTinyHyperGraphPipelineInput", "buildInputNodesWithPortPoints", "TRACE_DENSITY_PORTFOLIO_MIN_ROUTE_COUNT", "TRACE_DENSITY_PORTFOLIO_MAX_ROUTE_COUNT"] }],
  },
  { repository: repositories[1], relative: "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts", sourcePath: "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts",
    classes: [{ name: "AutoroutingPipelineSolver9_PreloadedTraceGraph", solverIdentity: true, pipelineCallback: true }],
  },
  { repository: repositories[1], relative: "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types.ts", typeOnly: true },
]
const runtimeTokens = (text: string): string => JSON.stringify(lexicalTokens(transpiler.transformSync(text)).map(({ kind, text }) => [kind, text]))
const expressionCompiled = (node: any, file: any): string => {
  const emitted = parse(transpiler.transformSync(`const Qualified=${node.getText(file)};`))
  return variable(emitted, "Qualified").initializer.getText(emitted)
}
const stepCallback = (cls: any, file: any): any => {
  const definition = member(cls, "pipelineDef")
  assert(ts.isArrayLiteralExpression(definition.initializer))
  const calls = definition.initializer.elements.filter((node: any) => ts.isCallExpression(node) && node.arguments[0]?.text === "portPointPathingSolver")
  assert.equal(calls.length, 1)
  assert.equal(calls[0].arguments.length, 3)
  const callback = calls[0].arguments[2]
  assert(ts.isArrowFunction(callback))
  return callback
}
const findPublishedClass = (spec: any): any => {
  if (spec.published) return publishedClass(spec.published)
  const matches: any[] = []
  for (const statement of publishedFile.statements) if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    const cls = declaration.initializer
    if (!cls || !ts.isClassExpression(cls)) continue
    if (spec.solverIdentity) {
      const solverName = cls.members.find((node: any) => node.name?.getText(publishedFile) === "getSolverName")
      if (solverName?.getText(publishedFile).includes(JSON.stringify(spec.name))) matches.push(cls)
    } else if (spec.extendsPublished && cls.heritageClauses?.some((clause: any) => clause.types.some((type: any) => type.expression.getText(publishedFile) === spec.extendsPublished))) {
      if (cls.members.length === 1 && cls.members[0].name?.getText(publishedFile) === "computeG") matches.push(cls)
    }
  }
  assert.equal(matches.length, 1, spec.name)
  return matches[0]
}
const records: any[] = []
for (const definition of definitions) {
  const before = git(definition.repository.root, ["show", `${definition.repository.sourceBaseCommit}:${definition.relative}`])
  const after = readFileSync(join(definition.repository.root, definition.relative), "utf8")
  if (!definition.typeOnly) {
    const indexes = sourceMap.sources.flatMap((name: string, index: number) => name === definition.sourcePath ? [index] : [])
    assert.equal(indexes.length, 1, definition.sourcePath)
    assert.equal(before, sourceMap.sourcesContent[indexes[0]], definition.relative)
  }
  const sourceHandoff = handoff.repositories.find((row: any) => row.baseCommit === definition.repository.sourceBaseCommit)
  assert(sourceHandoff)
  assert.equal(git(definition.repository.root, ["rev-parse", "HEAD"]).trim(), sourceHandoff.candidateCommit ?? sourceHandoff.baseCommit)
  assert.equal(sha(after), sourceHandoff.files.find((row: any) => row.path === definition.relative && row.production)?.sha256)
  if (!allowDraft) assert.equal(git(definition.repository.root, ["status", "--porcelain", "--", definition.relative]).trim(), "")
  const checked = programFor(after)
  const record: any = { ...definition, before, after, beforeFile: parse(before), afterFile: checked.file, checker: checked.checker, aliases: {}, selections: [] }
  definition.repository.changedFiles.push({ relative: definition.relative, beforeSha256: sha(before), afterSha256: sha(after) })
  if (definition.typeOnly) {
    assert.equal(runtimeTokens(before), runtimeTokens(after), "Hg option changes must be type-only")
    records.push(record)
    continue
  }
  for (const spec of definition.variables ?? []) {
    record.selections.push({ name: spec.name, kind: "expression", base: variable(record.beforeFile, spec.name).initializer, candidate: variable(record.afterFile, spec.name).initializer, published: variable(publishedFile, spec.published).initializer })
  }
  for (const spec of definition.classes ?? []) {
    const baseClass = sourceClass(record.beforeFile, spec.name), candidateClass = sourceClass(record.afterFile, spec.name), actualClass = findPublishedClass(spec)
    if (spec.pipelineCallback) record.selections.push({ name: `${spec.name}.pipelineDef.portPointPathingSolver`, kind: "expression", base: stepCallback(baseClass, record.beforeFile), candidate: stepCallback(candidateClass, record.afterFile), published: stepCallback(actualClass, publishedFile) })
    for (const name of spec.members ?? []) record.selections.push({ name: `${spec.name}.${name}`, memberName: name, kind: "member", base: member(baseClass, name), candidate: member(candidateClass, name), published: member(actualClass, name), helpers: spec.helpers ?? [] })
    for (const name of spec.insertedMembers ?? []) {
      const candidate = member(candidateClass, name), index = candidateClass.members.indexOf(candidate)
      const nextMember = candidateClass.members.slice(index + 1).find((node: any) => baseClass.members.some((base: any) => base.name?.getText(record.beforeFile) === node.name?.getText(record.afterFile)))
      assert(nextMember, `Insertion anchor ${name}`)
      record.selections.push({ name: `${spec.name}.${name}`, memberName: name, kind: "insertedMember", candidate, published: member(actualClass, nextMember.name.getText(record.afterFile)) })
    }
  }
  const outside = (file: any, candidate: boolean): string => {
    const edits: any[] = []
    for (const selection of record.selections) {
      if (!candidate && !selection.base) continue
      const node = candidate ? selection.candidate : selection.base
      edits.push({ start: node.getStart(file), end: node.end, replacement: selection.kind === "expression" ? "undefined" : "" })
    }
    for (const name of definition.localHelpers ?? []) {
      const node = variable(file, name).initializer
      edits.push({ start: node.getStart(file), end: node.end, replacement: "undefined" })
    }
    let text = file.text
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end)
    return runtimeTokens(text)
  }
  assert.equal(outside(record.beforeFile, false), outside(record.afterFile, true), `Unrelated runtime source changed: ${definition.relative}`)
  records.push(record)
}
const adapter = records[2]
const orderHelperRelative = "lib/selective-rerip-tiny-hyper-graph-solver.ts"
const orderHelperSource = git(tinyRoot, ["show", `${tinyBase}:${orderHelperRelative}`])
const orderHelperIndex = sourceMap.sources.indexOf(`../node_modules/tiny-hypergraph/${orderHelperRelative}`)
assert(orderHelperIndex >= 0)
assert.equal(orderHelperSource, sourceMap.sourcesContent[orderHelperIndex])
const orderHelperFile = parse(orderHelperSource)
const orderHelpers = orderHelperFile.statements.filter((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === "orderConnectionsByNetCardinality")
assert.equal(orderHelpers.length, 1)
const orderHelperText = orderHelpers[0].getText(orderHelperFile)
adapter.externalPrelude = transpiler.transformSync(orderHelperText.replace(/^export /, ""))
const preludeFor = (record: any, names: string[], candidate = false): string => transpiler.transformSync(names.map(name => {
  const file = candidate ? record.afterFile : record.beforeFile, node = variable(file, name)
  return `const ${candidate ? renameNode(record, node, record.aliases) : node.getText(file)};`
}).join("\n"))
for (const record of records) for (const selection of record.selections ?? []) {
  if (selection.kind === "insertedMember") continue
  const prelude = (selection.helpers?.length ? record.externalPrelude ?? "" : "") + preludeFor(record, selection.helpers ?? [])
  const baseCompiled = selection.kind === "expression" ? expressionCompiled(selection.base, record.beforeFile) : compileMember(selection.base.getText(record.beforeFile))
  const baseCanonical = await canonical(baseCompiled, selection.kind === "expression", prelude)
  const publishedCanonical = await canonical(selection.published.getText(publishedFile), selection.kind === "expression")
  const aliases = deriveAliases(baseCanonical, publishedCanonical, selection.name)
  mergeAliases(record.aliases, aliases)
  selection.qualification = { baseCanonical, publishedCanonical, aliases }
}
const spans: any[] = []
for (const record of records) for (const selection of record.selections ?? []) {
  const renamed = renameNode(record, selection.candidate, record.aliases)
  const callbackFile = selection.kind === "expression" ? parse(`const Qualified=${renamed};`) : undefined
  const compiled = selection.kind === "expression" ? expressionCompiled(variable(callbackFile, "Qualified").initializer, callbackFile) : compileMember(renamed)
  const prelude = (selection.helpers?.length ? record.externalPrelude ?? "" : "") + preludeFor(record, selection.helpers ?? [], true)
  const emitted = parse(await canonical(compiled, selection.kind === "expression", prelude))
  assert.equal(emitted.statements.length, 1, `Source-local helpers must inline within ${selection.name}`)
  const replacementText = selection.kind === "expression" ? variable(emitted, "Qualified").initializer.getText(emitted) : member(sourceClass(emitted, "Qualified"), selection.memberName).getText(emitted)
  const inserted = selection.kind === "insertedMember", startCharacter = selection.published.getStart(publishedFile), endCharacter = inserted ? startCharacter : selection.published.end
  const originalText = original.slice(startCharacter, endCharacter)
  spans.push({ kind: inserted ? "insert" : "replace", name: selection.name, sourceRepository: record.repository.repository, sourceRelative: record.relative, startCharacter, endCharacter,
    startByte: Buffer.byteLength(original.slice(0, startCharacter)), endByte: Buffer.byteLength(original.slice(0, endCharacter)), originalText, replacementText,
    originalSha256: sha(originalText), replacementSha256: sha(replacementText), compiledBaseEquivalent: inserted ? null : true,
    ...(inserted ? {} : { baseCanonicalSha256: sha(selection.qualification.publishedCanonical), aliases: selection.qualification.aliases }),
  })
}
spans.sort((a, b) => a.startCharacter - b.startCharacter || (a.kind === "insert" ? -1 : 1))
let cursor = 0, candidate = ""
const unchangedSegments: any[] = []
for (const span of spans) {
  assert(span.startCharacter >= cursor)
  const unchanged = original.slice(cursor, span.startCharacter)
  if (unchanged.length) unchangedSegments.push({ startByte: Buffer.byteLength(original.slice(0, cursor)), endByte: span.startByte, candidateStartByte: Buffer.byteLength(candidate), candidateEndByte: Buffer.byteLength(candidate + unchanged), sha256: sha(unchanged) })
  candidate += unchanged + span.replacementText
  cursor = span.endCharacter
}
const tail = original.slice(cursor)
if (tail.length) unchangedSegments.push({ startByte: Buffer.byteLength(original.slice(0, cursor)), endByte: Buffer.byteLength(original), candidateStartByte: Buffer.byteLength(candidate), candidateEndByte: Buffer.byteLength(candidate + tail), sha256: sha(tail) })
candidate += tail
parse(candidate)
for (const segment of unchangedSegments) assert.equal(sha(Buffer.from(candidate).subarray(segment.candidateStartByte, segment.candidateEndByte)), segment.sha256)
const source = { repositories: repositories.map(({ root, ...repository }) => {
  const files = repository.changedFiles.map((row: any) => row.relative), patch = git(root, ["diff", "--binary", repository.sourceBaseCommit, "--", ...files])
  const candidateCommit = git(root, ["status", "--porcelain", "--", ...files]).trim() ? null : git(root, ["rev-parse", "HEAD"]).trim()
  const sourceHandoff = handoff.repositories.find((row: any) => row.baseCommit === repository.sourceBaseCommit)
  assert.equal(candidateCommit, sourceHandoff.candidateCommit)
  assert.equal(sha(patch), sourceHandoff.patches.production.sha256)
  assert(allowDraft || candidateCommit)
  writeFileSync(join(outDir, repository.productionPatchFile), patch)
  return { ...repository, candidateCommit, productionPatchSha256: sha(patch) }
}) }
const mapping = { schemaVersion: 2, passed: true, sourceFrozen: !allowDraft, originalAutorouterSha256: sha(original), candidateAutorouterSha256: sha(candidate), sourceMapSha256: sha(sourceMapText), source, spans, unchangedSegments,
  qualification: { allOutsideBytesUnchanged: true, unrelatedSourceRuntimeUnchanged: true, compiledBaseEquivalent: true, sourceMapGeneratedOffsetsUsed: false,
    typeErasure: "TypeScript5.9.3 transpileModule targeting ESNext; no Bun syntax optimization",
    canonicalizer: "Terser5.51.2 three compression passes and deterministic lexical names; differing free bindings mapped bijectively; properties and local bindings must match exactly",
    sourceAliases: records.filter(record => !record.typeOnly).map(record => ({ relative: record.relative, aliases: record.aliases })),
    unchangedImportedHelper: { name: "orderConnectionsByNetCardinality", relative: orderHelperRelative, sourceBaseCommit: tinyBase, sourceMapIndex: orderHelperIndex, sourceFileSha256: sha(orderHelperSource), declarationSha256: sha(orderHelperText), qualification: "Included unchanged in complete adapter constructor baseline equivalence" },
    bun: Bun.version, typescript: ts.version, terser: require("terser/package.json").version },
  sourceHandoffSha256: sha(handoffText), mapperSha256: sha(readFileSync(import.meta.path)), moduleImported: false, nativeRoutingExecuted: false,
}
mkdirSync(join(outDir, "dist"), { recursive: true })
writeFileSync(join(outDir, "dist/two-via-candidate.js"), candidate)
writeFileSync(join(outDir, "two-via-source-mapping.json"), JSON.stringify(mapping, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, replacements: spans.filter(span => span.kind === "replace").length, insertions: spans.filter(span => span.kind === "insert").length, candidateAutorouterSha256: mapping.candidateAutorouterSha256, source, nativeRoutingExecuted: false }))
