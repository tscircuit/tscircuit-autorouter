import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"

const [baseRoot, candidateRoot, arPath, mapPath, typescriptPath, outputPath, sourceCandidateCommit] = process.argv.slice(2)
assert(baseRoot && candidateRoot && arPath && mapPath && typescriptPath && outputPath)
assert.equal(sourceCandidateCommit, "21c7c3d0ecd6b929f0831b495f13e7163187ec55")
assert.equal(Bun.version, "1.4.3")
const ts = createRequire(import.meta.url)(resolve(typescriptPath))
assert.equal(ts.version, "5.9.3")
const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex")
const read = (path: string): string => {
  const bytes = readFileSync(path)
  return (path.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString()
}
const ar = read(arPath), mapText = read(mapPath), sourceMap = JSON.parse(mapText)
assert.equal(sha(ar), "5695c6361c0f7a7dc26ddd1b9264b8a8c122e5f7b9610cf24c6af3b99c545df1")
assert.equal(sha(mapText), "9edff1c06b9a33231e581e2aae1115cfd96213f28df65eb3d56d7d78b078241d")
const relative = "lib/distance-aware-tiny-hypergraph-solver.ts"
const beforeText = readFileSync(join(baseRoot, relative), "utf8")
const afterText = readFileSync(join(candidateRoot, relative), "utf8")
assert.equal(sha(beforeText), "68465bf106dbaecbc8f64d2615d2de9a785c77f3e337fbe19f51630e6dd3d3e0")
assert.equal(sha(afterText), "06cb70baab99c198dc6ec1a2c0ded5c746fbbc6392dcb5c748ec169a49f57d27")
const matchingSources = sourceMap.sources.map((name: string, index: number) => ({ name, index })).filter((row: any) => row.name.endsWith("/tiny-hypergraph/" + relative))
assert.equal(matchingSources.length, 1)
assert.equal(sourceMap.sourcesContent[matchingSources[0].index], beforeText)
const parse = (text: string): any => {
  const node = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(node.parseDiagnostics.length, 0)
  return node
}
const before = parse(beforeText), published = parse(ar)
const filename = "/qualification/candidate.ts"
const host = ts.createCompilerHost({ noLib: true })
host.getSourceFile = (name: string): any => name === filename ? ts.createSourceFile(name, afterText, ts.ScriptTarget.Latest, true) : undefined
host.fileExists = (name: string): boolean => name === filename
host.readFile = (name: string): string | undefined => name === filename ? afterText : undefined
const program = ts.createProgram([filename], { noLib: true, types: [], target: ts.ScriptTarget.ESNext }, host)
const after = program.getSourceFile(filename), checker = program.getTypeChecker()
assert.equal(after.parseDiagnostics.length, 0)
const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", treeShaking: false })
function runtimeImports(file: any): string[] {
  return file.statements.filter(ts.isImportDeclaration).flatMap((node: any) => {
    if (node.importClause?.isTypeOnly) return []
    assert(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings))
    return node.importClause.namedBindings.elements.filter((item: any) => !item.isTypeOnly).map((item: any) => `${node.moduleSpecifier.text}:${item.name.text}`)
  }).sort()
}
assert.deepEqual(runtimeImports(before), ["./core:TinyHyperGraphSolver", "./indexed-candidate-heap:IndexedCandidateHeap"].sort())
assert.deepEqual(runtimeImports(after), ["./computeRegionCost:computeRegionCostForArea", "./core:TinyHyperGraphSolver", "./indexed-candidate-heap:IndexedCandidateHeap"].sort())
const className = "DistanceAwareTinyHyperGraphSolver"
const getClass = (file: any): any => {
  const nodes = file.statements.filter((node: any) => ts.isClassDeclaration(node) && node.name?.text === className)
  assert.equal(nodes.length, 1)
  return nodes[0]
}
const oldClass = getClass(before), newClass = getClass(after)
const runtimeStatements = after.statements.filter((node: any) => !ts.isImportDeclaration(node) && !ts.isTypeAliasDeclaration(node))
assert.equal(runtimeStatements.length, 2)
const helper = runtimeStatements.find(ts.isVariableStatement)
assert(helper && helper.declarationList.declarations.length === 1)
assert.equal(helper.declarationList.declarations[0].name.text, "distanceToViaRegion")
assert.equal(runtimeStatements.filter(ts.isClassDeclaration).length, 1)
for (const name of ["constructor", "_setup", "onPathFound"]) {
  const find = (node: any): any => node.members.find((member: any) => name === "constructor" ? ts.isConstructorDeclaration(member) : member.name?.text === name)
  const oldMember = find(oldClass), newMember = find(newClass)
  assert(oldMember && newMember)
  assert.equal(transpiler.transformSync(`class Compared extends Base { ${oldMember.getText(before)} }`), transpiler.transformSync(`class Compared extends Base { ${newMember.getText(after)} }`), `Unrelated method changed: ${name}`)
}
const externalAliases: Record<string, string> = {
  TinyHyperGraphSolver: "PQ", IndexedCandidateHeap: "yJ", computeRegionCostForArea: "dJ",
  DistanceAwareTinyHyperGraphSolver: "kQ", distanceToViaRegion: "tinyJointViaDistanceToRegion",
}
const aliasSymbols = new Map<any, string>()
for (const node of after.statements) {
  if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
    for (const item of node.importClause.namedBindings.elements) if (!item.isTypeOnly) {
      assert(item.name.text in externalAliases)
      aliasSymbols.set(checker.getSymbolAtLocation(item.name), externalAliases[item.name.text])
    }
  }
}
aliasSymbols.set(checker.getSymbolAtLocation(newClass.name), "kQ")
aliasSymbols.set(checker.getSymbolAtLocation(helper.declarationList.declarations[0].name), "tinyJointViaDistanceToRegion")
assert.equal(aliasSymbols.size, 5)
assert(!aliasSymbols.has(undefined))
const printer = ts.createPrinter()
function mappedRuntime(node: any): string {
  const transformed = ts.transform(node, [(context: any) => {
    const visit = (item: any): any => {
      if (ts.isIdentifier(item)) {
        const symbol = checker.getSymbolAtLocation(item)
        if (aliasSymbols.has(symbol)) return ts.factory.createIdentifier(aliasSymbols.get(symbol))
      }
      return ts.visitEachChild(item, visit, context)
    }
    return visit
  }])
  const printed = printer.printNode(ts.EmitHint.Unspecified, transformed.transformed[0], after).replace(/^export\s+/, "")
  transformed.dispose()
  return transpiler.transformSync(printed).trim().replace(/^export\s+/, "")
}
const newClassBlock = mappedRuntime(newClass)
const helperBlock = mappedRuntime(helper)
assert(newClassBlock.startsWith("class kQ extends PQ"), newClassBlock.slice(0, 250))
assert(helperBlock.startsWith("const tinyJointViaDistanceToRegion"))
assert(!ar.includes("tinyJointViaDistanceToRegion"))
let oldDeclaration: any
const existingAliases: Record<string, any[]> = Object.fromEntries(["PQ", "yJ", "dJ", "kQ"].map(name => [name, []]))
function collect(node: any): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text in existingAliases) existingAliases[node.name.text].push(node)
  ts.forEachChild(node, collect)
}
collect(published)
for (const [name, declarations] of Object.entries(existingAliases)) assert.equal(declarations.length, 1, name)
oldDeclaration = existingAliases.kQ[0]
assert(ts.isClassExpression(oldDeclaration.initializer))
const oldBlock = oldDeclaration.initializer.getText(published)
assert.equal(sha(oldBlock), "ffab303c62075bd1870dae332e07e77f0768b1ad0bb01645cf18bde0684b883a")
assert.equal(sha(existingAliases.dJ[0].initializer.getText(published)), "b62b05fd880975672dd8bbe2fa215576f31cd2b4f67c5d3a7d14891c75e2f758")
let statement = oldDeclaration
while (statement.parent !== published) statement = statement.parent
assert(ts.isVariableStatement(statement))
const spans: any[] = [
  { kind: "insert", name: "distanceToViaRegion", relative, characterOffset: statement.getStart(published), oldBlock: "", newBlock: helperBlock + "\n" },
  { kind: "replace", name: className, relative, characterOffset: oldDeclaration.initializer.getStart(published), oldBlock, newBlock: newClassBlock },
].sort((a, b) => a.characterOffset - b.characterOffset)
for (const span of spans) {
  span.byteOffset = Buffer.byteLength(ar.slice(0, span.characterOffset))
  span.oldBlockSha256 = sha(span.oldBlock)
  span.newBlockSha256 = sha(span.newBlock)
  assert.equal(ar.slice(span.characterOffset, span.characterOffset + span.oldBlock.length), span.oldBlock)
}
let previous = 0
const unchangedSegments: any[] = []
for (const span of spans) {
  assert(span.characterOffset >= previous)
  unchangedSegments.push({ start: previous, end: span.characterOffset, sha256: sha(ar.slice(previous, span.characterOffset)) })
  previous = span.characterOffset + span.oldBlock.length
}
unchangedSegments.push({ start: previous, end: ar.length, sha256: sha(ar.slice(previous)) })
let candidate = ar
for (const span of [...spans].reverse()) candidate = candidate.slice(0, span.characterOffset) + span.newBlock + candidate.slice(span.characterOffset + span.oldBlock.length)
parse(candidate)
const declarations = spans.map(({ oldBlock, newBlock, ...row }) => row)
const proof = {
  passed: true, schemaVersion: 2, sourceCandidateCommit, bun: Bun.version, typescript: ts.version,
  sourceFiles: { [relative]: { beforeSha256: sha(beforeText), afterSha256: sha(afterText) } },
  sourceScopeQualification: { onlyDeclaredClassAndDistanceHelper: true, constructorSetupOnPathFoundUnchanged: true, runtimeImports: runtimeImports(after), lexicalAliasBindingVerified: true },
  originalAutorouterSha256: sha(ar), candidateAutorouterSha256: sha(candidate),
  sourceMapSha256: sha(mapText), publishedSourceContentExact: true, sourceMapGeneratedPositionsUsed: false,
  baselineClassBinding: { sourceSha256: sha(beforeText), classVariable: "kQ", classSha256: sha(oldBlock), qualification: "Published class and existing cost helper independently canonicalized against pinned source; fixed whole-entry/class/helper hashes checked here." },
  externalAliases, unchangedSegments, unchangedDeclarations: [],
  replacedDeclarations: declarations.filter(row => row.kind === "replace"), insertedDeclarations: declarations.filter(row => row.kind === "insert"),
  publishedCallCoverage: { classVariable: "kQ", allBytesOutsideDeclaredSpansUnchanged: true },
  nativeRoutingExecuted: false, moduleImported: false,
  normalization: "TypeScript erasure and checker-bound symbol aliases only. Exact reviewed class replaces its one emitted class expression; new source distance helper is inserted before the containing top-level statement. Existing cost/heap/base-class bindings remain unchanged, as do all other AR bytes and all Core files. No hooks, wrappers, cap/cost-law or options changes.",
}
mkdirSync(outputPath, { recursive: true })
writeFileSync(join(outputPath, "source-mapping.json"), JSON.stringify(proof, null, 2) + "\n")
writeFileSync(join(outputPath, "overlay-spans.json"), JSON.stringify({ ...proof, spans }, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, sourceFiles: proof.sourceFiles, candidateAutorouterSha256: proof.candidateAutorouterSha256, replaced: proof.replacedDeclarations.length, inserted: proof.insertedDeclarations.length }))
