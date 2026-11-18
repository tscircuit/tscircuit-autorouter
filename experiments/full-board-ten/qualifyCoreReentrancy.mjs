import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const [rootArgument, sourceProofArgument, typescriptPath] = process.argv.slice(2)
assert(rootArgument && sourceProofArgument, "Expected runtime root and authenticated source-pair proof")
const ts = (await import(typescriptPath ?? "typescript")).default
const root = resolve(rootArgument)
const sourceProof = resolve(sourceProofArgument)
const sha = value => createHash("sha256").update(value).digest("hex")
const read = path => readFileSync(path, "utf8")
assert.equal(JSON.parse(read(join(sourceProof, "result.json"))).passed, true)
const sourcePaths = {
  renderable: "lib/components/base-components/Renderable.ts",
  group: "lib/components/primitive-components/Group/Group.ts",
  helper: "lib/components/primitive-components/CopperPour/CopperPour_doInitialPcbCopperPourRender.ts",
  pour: "lib/components/primitive-components/CopperPour/CopperPour.ts",
}
const publishedHashes = {
  "dist/index.js": "53798b0d37ae966acca93e503de4d20e6bb98086d9ec27313646030c364ec519",
  "dist/chunk-MS7QPCOY.js": "7ac2d30da88918e7faa8fcfb7770e25321bbbec3edcf7b2e4cdc21713e54a24a",
}

// Bind identifiers before comparing them: only lexical aliases may differ.
// Property names, module origins, import names, syntax and literals stay exact.
function context(text, fileName) {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(file.parseDiagnostics.length, 0, `Parse diagnostics in ${fileName}`)
  const host = {
    getSourceFile: name => name === fileName ? file : undefined,
    getDefaultLibFileName: () => "", writeFile: () => {},
    getCurrentDirectory: () => "/", getDirectories: () => [],
    fileExists: name => name === fileName,
    readFile: name => name === fileName ? text : undefined,
    getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  }
  const program = ts.createProgram([fileName], { allowJs: true, noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext }, host)
  const checker = program.getTypeChecker()
  const markers = [...text.matchAll(/^\/\/ ((?:lib\/|node_modules\/|package\.json|index\.ts)[^\n]*)$/gm)]
  const moduleFor = node => markers.findLast(marker => marker.index < node.getStart(file))?.[1] ?? "<entry>"
  const declarations = file.statements.flatMap(statement => {
    if (ts.isVariableStatement(statement)) return [...statement.declarationList.declarations]
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) return [statement]
    return []
  })
  const named = name => {
    const matches = declarations.filter(node => node.name?.getText(file) === name)
    assert.equal(matches.length, 1, `Exactly one declaration for ${name} in ${fileName}`)
    return matches[0]
  }
  const role = symbol => {
    assert(symbol?.declarations?.length, "Unbound nonstandard identifier")
    const declaration = symbol.declarations[0]
    if (ts.isImportSpecifier(declaration)) {
      const moduleName = declaration.parent.parent.parent.moduleSpecifier.text
      const importedName = declaration.propertyName?.text ?? declaration.name.text
      if (moduleName.startsWith("./chunk-")) {
        assert.equal(importedName, "PrimitiveComponent", "Unexpected relative free import in scoped patch")
        return `chunk:${importedName}`
      }
      return `import:${moduleName}:${importedName}`
    }
    let top = declaration
    while (top.parent && top.parent !== file) top = top.parent
    assert.equal(top.parent, file)
    return `source:${moduleFor(top)}:${symbol.name.replace(/\d+$/, "")}`
  }
  const globalByRole = new Map()
  const globalByName = new Map()
  for (const node of declarations) {
    if (!node.name || !ts.isIdentifier(node.name)) continue
    const symbol = checker.getSymbolAtLocation(node.name)
    const key = role(symbol)
    globalByName.set(node.name.text, { symbol, name: node.name.text, node, role: key })
    const current = globalByRole.get(key)
    if (current) globalByRole.set(key, null)
    else if (!globalByRole.has(key)) globalByRole.set(key, { symbol, name: node.name.text, node })
  }
  for (const statement of file.statements.filter(ts.isImportDeclaration)) {
    for (const specifier of statement.importClause?.namedBindings?.elements ?? []) {
      const symbol = checker.getSymbolAtLocation(specifier.name)
      if (statement.moduleSpecifier.text.startsWith("./chunk-") && (specifier.propertyName?.text ?? specifier.name.text) !== "PrimitiveComponent") continue
      const key = role(symbol)
      globalByName.set(specifier.name.text, { symbol, name: specifier.name.text, node: specifier, role: key })
      if (!globalByRole.has(key)) globalByRole.set(key, { symbol, name: specifier.name.text, node: specifier })
    }
  }
  return { text, file, checker, moduleFor, declarations, named, role, globalByRole, globalByName }
}

const propertyIdentifier = node => (
  (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
  ((ts.isPropertyAssignment(node.parent) || ts.isMethodDeclaration(node.parent) || ts.isGetAccessorDeclaration(node.parent) || ts.isSetAccessorDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent)) && node.parent.name === node) ||
  (ts.isBindingElement(node.parent) && node.parent.propertyName === node)
)
const standardGlobals = new Set(["Promise", "WeakMap", "Set", "Error", "undefined", "console", "Map"])
function canonical(ctx, nodes) {
  const local = new Map()
  const inside = node => nodes.some(rootNode => node.pos >= rootNode.pos && node.end <= rootNode.end)
  const collect = node => {
    if (ts.isIdentifier(node) && !propertyIdentifier(node)) {
      const symbol = ctx.checker.getSymbolAtLocation(node)
      if (symbol?.declarations?.some(inside) && !local.has(symbol)) local.set(symbol, `local:${local.size}`)
    }
    ts.forEachChild(node, collect)
  }
  nodes.forEach(collect)
  const tree = node => {
    if (ts.isShorthandPropertyAssignment(node)) return [node.kind, "property-key", node.name.text, tree(node.name)]
    if (ts.isBindingElement(node) && !node.propertyName && ts.isObjectBindingPattern(node.parent) && ts.isIdentifier(node.name)) return [node.kind, "property-key", node.name.text, node.getChildren(ctx.file).map(tree)]
    if (ts.isIdentifier(node)) {
      if (propertyIdentifier(node)) return [node.kind, "property", node.text]
      const symbol = ctx.checker.getSymbolAtLocation(node)
      if (!symbol) {
        assert(standardGlobals.has(node.text), `Unexpected unresolved identifier ${node.text}`)
        return [node.kind, "global", node.text]
      }
      return [node.kind, local.get(symbol) ?? ctx.role(symbol)]
    }
    const children = node.getChildren(ctx.file)
    if (!children.length) {
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return null
      return [node.kind, ts.isStringLiteral(node) ? node.text : node.getText(ctx.file)]
    }
    return [node.kind, children.map(tree)]
  }
  return JSON.stringify(nodes.map(tree))
}

function selected(ctx, type) {
  if (type === "phases") return [ctx.named("orderedRenderPhases").parent.parent]
  if (type === "dependencies") return [ctx.named("asyncPhaseDependencies").parent.parent]
  if (type === "group") {
    const matches = ctx.named("Group").initializer.members.filter(node => node.name?.getText(ctx.file) === "_startAsyncAutorouting")
    assert.equal(matches.length, 1)
    return matches
  }
  if (type === "pour") return [ctx.named("CopperPour").parent.parent]
  assert.equal(type, "helper")
  const nodes = ctx.file.statements.filter(node => ctx.moduleFor(node) === sourcePaths.helper && !ts.isImportDeclaration(node))
  assert(nodes.length >= 4)
  assert.equal(nodes[0].getText(ctx.file).startsWith("var pendingCopperPourRenders"), true)
  assert.equal(nodes.at(-1).name?.text, "CopperPour_doInitialPcbCopperPourRender")
  assert.equal(ctx.file.statements.indexOf(nodes.at(-1)) - ctx.file.statements.indexOf(nodes[0]) + 1, nodes.length, "Helper body must be contiguous")
  return nodes
}

function transplant(candidate, published, nodes) {
  const start = nodes[0].getStart(candidate.file), end = nodes.at(-1).end
  const substitutions = []
  const existingRoles = new Set()
  const inside = node => node.pos >= nodes[0].pos && node.end <= end
  const visit = node => {
    if (ts.isIdentifier(node) && !propertyIdentifier(node)) {
      const symbol = candidate.checker.getSymbolAtLocation(node)
      if (symbol?.declarations?.length) {
        const declaration = symbol.declarations[0]
        let top = declaration
        while (top.parent && top.parent !== candidate.file) top = top.parent
        const topLevel = ts.isVariableStatement(top) && top.declarationList.declarations.some(row => row.name === declaration.name) || ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration) || ts.isImportSpecifier(declaration)
        if (!inside(declaration) || topLevel) {
          const role = candidate.role(symbol)
          const sameName = published.globalByName.get(node.text)
          const target = sameName?.role === role ? sameName : published.globalByRole.get(role)
          assert(target !== null, `Ambiguous free binding ${role}`)
          if (target) {
            existingRoles.add(role)
            if (target.name !== node.text) substitutions.push({ start: node.getStart(candidate.file) - start, end: node.end - start, text: target.name })
          } else {
            assert(inside(declaration) && topLevel, `New free dependency ${role}`)
            assert(!published.declarations.some(row => row.name?.getText(published.file) === node.text), `New top-level declaration collides: ${node.text}`)
          }
        }
      } else assert(standardGlobals.has(node.text), `Unexpected global ${node.text}`)
    }
    ts.forEachChild(node, visit)
  }
  nodes.forEach(visit)
  let text = candidate.text.slice(start, end)
  for (const change of substitutions.sort((a, b) => b.start - a.start)) text = text.slice(0, change.start) + change.text + text.slice(change.end)
  return { text, freeBindingRoles: [...existingRoles].sort(), substitutions }
}

const paths = {}
for (const lane of ["base", "candidate"]) {
  const dist = join(sourceProof, lane, "dist")
  const files = readdirSync(dist).filter(name => name.endsWith(".js"))
  const renderableFiles = files.filter(name => read(join(dist, name)).includes(`// ${sourcePaths.renderable}\n`))
  assert.equal(renderableFiles.length, 1)
  paths[lane] = { entry: join(dist, "index.js"), chunk: join(dist, renderableFiles[0]) }
}
const contexts = {
  base: { entry: context(read(paths.base.entry), "/base-index.js"), chunk: context(read(paths.base.chunk), "/base-chunk.js") },
  candidate: { entry: context(read(paths.candidate.entry), "/candidate-index.js"), chunk: context(read(paths.candidate.chunk), "/candidate-chunk.js") },
  published: {
    entry: context(read(join(root, "npm/core/dist/index.js")), "/published-index.js"),
    chunk: context(read(join(root, "npm/core/dist/chunk-MS7QPCOY.js")), "/published-chunk.js"),
  },
}
for (const [path, hash] of Object.entries(publishedHashes)) assert.equal(sha(read(join(root, "npm/core", path))), hash)
const output = { entry: contexts.published.entry.text, chunk: contexts.published.chunk.text }
const mappings = []
const edits = { entry: [], chunk: [] }
for (const [type, file] of [["phases", "chunk"], ["dependencies", "chunk"], ["group", "entry"], ["helper", "entry"], ["pour", "entry"]]) {
  const base = contexts.base[file], candidate = contexts.candidate[file], published = contexts.published[file]
  const oldNodes = selected(base, type), newNodes = selected(candidate, type), publishedNodes = selected(published, type)
  assert.equal(canonical(base, oldNodes), canonical(published, publishedNodes), `Published source preimage differs: ${type}`)
  const replacement = transplant(candidate, published, newNodes)
  const start = publishedNodes[0].getStart(published.file), end = publishedNodes.at(-1).end
  edits[file].push({ start, end, text: replacement.text })
  mappings.push({ type, file, baseCompiledSha256: sha(oldNodes.map(node => node.getText(base.file)).join("\n")), candidateCompiledSha256: sha(newNodes.map(node => node.getText(candidate.file)).join("\n")), publishedBeforeSha256: sha(published.text.slice(start, end)), replacementSha256: sha(replacement.text), freeBindingRoles: replacement.freeBindingRoles, renamedReferences: replacement.substitutions.length })
}
for (const file of ["entry", "chunk"]) {
  for (const edit of edits[file].sort((a, b) => b.start - a.start)) output[file] = output[file].slice(0, edit.start) + edit.text + output[file].slice(edit.end)
  const mapped = context(output[file], `/mapped-${file}.js`)
  for (const mapping of mappings.filter(row => row.file === file)) assert.equal(canonical(mapped, selected(mapped, mapping.type)), canonical(contexts.candidate[file], selected(contexts.candidate[file], mapping.type)), `Candidate semantics changed during mapping: ${mapping.type}`)
}
const queue = ctx => ctx.named("Renderable").initializer.members.find(node => node.name?.getText(ctx.file) === "_queueAsyncEffect")
assert.equal(queue(contexts.base.chunk).getText(contexts.base.chunk.file), queue(contexts.candidate.chunk).getText(contexts.candidate.chunk.file), "Generic effect scheduling changed in source build")
const mappedChunk = context(output.chunk, "/mapped-queue.js")
assert.equal(queue(contexts.published.chunk).getText(contexts.published.chunk.file), queue(mappedChunk).getText(mappedChunk.file), "Generic published effect scheduling changed")
const destination = join(root, "core-reentrancy/reviewed-overlay/dist")
mkdirSync(destination, { recursive: true })
const runtimeChanges = []
for (const [file, name] of [["entry", "index.js"], ["chunk", "chunk-MS7QPCOY.js"]]) {
  writeFileSync(join(destination, name), output[file])
  runtimeChanges.push({ path: `dist/${name}`, beforeSha256: publishedHashes[`dist/${name}`], afterSha256: sha(output[file]), bytes: Buffer.byteLength(output[file]) })
}
const report = {
  assertionsPassed: true, sourceResultSha256: sha(read(join(sourceProof, "result.json"))),
  sourcePatchSha256: sha(read(join(sourceProof, "production.patch"))),
  sourceMethodBodyEquality: ["_queueAsyncEffect"], genericSchedulingUnchanged: true,
  sourceBuildToPublishedBaseEquivalence: true, candidateMappingSemanticallyIdentical: true,
  scope: "Two phase declarations, Group routing startup, CopperPour helper body and CopperPour class only; all remaining published bytes untouched.",
  mappings, runtimeChanges,
}
writeFileSync(join(root, "core-reentrancy/source-gate.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(root, "core-reentrancy/runtime-changes.json"), JSON.stringify(runtimeChanges, null, 2) + "\n")
console.log(JSON.stringify({ assertionsPassed: true, runtimeChanges, mappingCount: mappings.length }))
