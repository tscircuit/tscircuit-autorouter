import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { gunzipSync } from "node:zlib"

// Offline qualification only. CI reconstructs the exact reviewed span without
// installing a compiler or changing the published dependency graph.
const [basePath, candidatePath, arPath, sourceMapPath, typescriptPath, outputDirectory, candidateCommit] = process.argv.slice(2)
assert(basePath && candidatePath && arPath && sourceMapPath && typescriptPath && outputDirectory)
assert.equal(Bun.version, "1.4.3")
const ts = createRequire(import.meta.url)(resolve(typescriptPath))
assert.equal(ts.version, "5.9.3")
const compilerRequire = createRequire(resolve(typescriptPath))
const terser = compilerRequire("terser")
assert.equal(compilerRequire("terser/package.json").version, "5.51.2")
const sha = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex")
const read = (path: string): string => (path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path)).toString()
const original = read(arPath), mapText = read(sourceMapPath), before = read(basePath), after = read(candidatePath)
assert.equal(sha(original), "5695c6361c0f7a7dc26ddd1b9264b8a8c122e5f7b9610cf24c6af3b99c545df1")
assert.equal(sha(mapText), "9edff1c06b9a33231e581e2aae1115cfd96213f28df65eb3d56d7d78b078241d")
assert.equal(sha(before), "d9ddf24d2cef76012e7be01427c11429e86162dfbf74aa74a0b443493cddc114")
assert.equal(sha(after), "c2965fd33f7618f4b8477e91cb4cab62676ee5d3c133ef95052b1f12d857f81e")
const relative = "lib/HighDensitySolverA01/HighDensitySolverA01.ts"
const sourceMap = JSON.parse(mapText)
const matches = sourceMap.sources.map((name: string, index: number) => ({ name, index })).filter((row: any) => row.name.endsWith("/@tscircuit/high-density-a01/" + relative))
assert.equal(matches.length, 1)
assert.equal(sourceMap.sourcesContent[matches[0].index], before)
const parse = (text: string): any => {
  const file = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true)
  assert.equal(file.parseDiagnostics.length, 0)
  return file
}
const baseFile = parse(before)
const filename = "/qualification/candidate.ts"
const host = ts.createCompilerHost({ noLib: true })
host.getSourceFile = (name: string): any => name === filename ? ts.createSourceFile(name, after, ts.ScriptTarget.Latest, true) : undefined
host.fileExists = (name: string): boolean => name === filename
host.readFile = (name: string): string | undefined => name === filename ? after : undefined
const program = ts.createProgram([filename], { noLib: true, types: [], target: ts.ScriptTarget.ESNext }, host)
const candidateFile = program.getSourceFile(filename), checker = program.getTypeChecker()
const getMethod = (file: any): any => {
  const classes = file.statements.filter((node: any) => ts.isClassDeclaration(node) && node.name?.text === "HighDensitySolverA01")
  assert.equal(classes.length, 1)
  const methods = classes[0].members.filter((node: any) => ts.isMethodDeclaration(node) && node.name.text === "getOutput")
  assert.equal(methods.length, 1)
  return methods[0]
}
const oldSourceMethod = getMethod(baseFile), newSourceMethod = getMethod(candidateFile)
assert.equal(before.slice(0, oldSourceMethod.getStart(baseFile)), after.slice(0, newSourceMethod.getStart(candidateFile)))
assert.equal(before.slice(oldSourceMethod.end), after.slice(newSourceMethod.end))
const importBindings = candidateFile.statements.filter(ts.isImportDeclaration).flatMap((node: any) => node.importClause?.namedBindings?.elements ?? [])
const affineImport = importBindings.filter((node: any) => node.name.text === "applyAffineTransformToPoint")
assert.equal(affineImport.length, 1)
const affineSymbol = checker.getSymbolAtLocation(affineImport[0].name)
assert(affineSymbol)
let renamedReferences = 0
const transformed = ts.transform(newSourceMethod, [(context: any) => {
  const visit = (node: any): any => {
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === affineSymbol) {
      renamedReferences++
      return ts.factory.createIdentifier("Ii")
    }
    return ts.visitEachChild(node, visit, context)
  }
  return visit
}])
const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, transformed.transformed[0], candidateFile)
transformed.dispose()
assert.equal(renamedReferences, 2)
const emitted = new Bun.Transpiler({ loader: "ts", target: "bun", treeShaking: false }).transformSync(`class QualifiedMethod { ${printed} }`)
const emittedFile = parse(emitted)
const newText = emittedFile.statements[0].members[0].getText(emittedFile)
assert(newText.startsWith("getOutput()"))
const publishedFile = parse(original)
const declarations: any[] = []
const helperDeclarations: any[] = []
const collect = (node: any): void => {
  if (ts.isVariableDeclaration(node) && node.name.getText(publishedFile) === "Oi") declarations.push(node)
  if (ts.isFunctionDeclaration(node) && node.name?.text === "Ii") helperDeclarations.push(node)
  ts.forEachChild(node, collect)
}
collect(publishedFile)
assert.equal(declarations.length, 1)
assert.equal(helperDeclarations.length, 1)
assert.equal(sha(helperDeclarations[0].getText(publishedFile)), "3f4b93b223501b45f28f3bacd7cad3f693cfd1cca6f0873a13d11a25d47607ac")
assert(ts.isClassExpression(declarations[0].initializer))
const methods = declarations[0].initializer.members.filter((node: any) => ts.isMethodDeclaration(node) && node.name.text === "getOutput")
assert.equal(methods.length, 1)
const method = methods[0], oldText = method.getText(publishedFile)
assert.equal(sha(oldText), "a7c1aabe33cf5ef428644a34a9bcc7831bdaf6313df9cad7bbe4ac52a772ffab")
// Independent compilation of the pinned base must normalize to the published
// method, including local variable renaming and the original minifier's folds.
const baseMethodText = oldSourceMethod.getText(baseFile)
assert.equal(baseMethodText.split("applyAffineTransformToPoint").length - 1, 2)
const compiledBase = new Bun.Transpiler({ loader: "ts", target: "bun", treeShaking: false }).transformSync(`class QualifiedMethod { ${baseMethodText.replaceAll("applyAffineTransformToPoint", "Ii")} }`)
const baseEmission = parse(compiledBase).statements[0].members[0].getText()
const canonicalize = async (methodText: string): Promise<string> => {
  const result = await terser.minify(`export class QualifiedMethod { ${methodText} }`, { module: true, compress: { passes: 3 }, mangle: { toplevel: true, nth_identifier: { get: (index: number): string => `binding${index}` } } })
  assert(result.code)
  return result.code
}
const baseCanonical = await canonicalize(baseEmission)
assert.equal(baseCanonical, await canonicalize(oldText), "Compiled base differs from the published A01 method")
assert.notEqual(baseCanonical, await canonicalize(newText), "Candidate did not change the published method")
const startCharacter = method.getStart(publishedFile), endCharacter = method.end
assert.deepEqual([startCharacter, endCharacter], [220936, 221703])
const prefix = original.slice(0, startCharacter), suffix = original.slice(endCharacter)
const candidate = prefix + newText + suffix
parse(candidate)
const proof = {
  schemaVersion: 1, passed: true,
  source: { repository: "tscircuit/high-density-a01", relative, baseCommit: "85ee23a25403bbb79be14b6d0783e592928a85a0", candidateCommit: candidateCommit ?? null, baseSha256: sha(before), candidateSha256: sha(after) },
  originalAutorouterSha256: sha(original), candidateAutorouterSha256: sha(candidate), sourceMapSha256: sha(mapText),
  span: { startByte: Buffer.byteLength(prefix), endByte: Buffer.byteLength(prefix + oldText), startCharacter, endCharacter, oldText, newText, oldSha256: sha(oldText), newSha256: sha(newText) },
  unchangedPrefixSha256: sha(prefix), unchangedSuffixSha256: sha(suffix),
  qualification: { publishedSourceExact: true, publishedSourceMapMember: matches[0].name, onlySourceMethodChanged: true, compiledBaseEquivalent: true, baseCanonicalSha256: sha(baseCanonical), canonicalizer: "Terser5.51.2, three compress passes and deterministic lexical names on both independently compiled base and published method", sourceMethodBeforeSha256: sha(oldSourceMethod.getText(baseFile)), sourceMethodAfterSha256: sha(newSourceMethod.getText(candidateFile)), classBinding: "Oi", affineSourceSymbol: "applyAffineTransformToPoint", affinePublishedBinding: "Ii", affineBindingSha256: sha(helperDeclarations[0].getText(publishedFile)), lexicalAliasReferences: renamedReferences, allOutsideBytesUnchanged: true, sourceMapGeneratedOffsetsUsed: false, bun: Bun.version, typescript: ts.version },
  scope: "Only A01.getOutput is replaced. All other published AR bytes and every Core/Main/Eval entry and package alias stay unchanged. No hooks, solver option or budget changes.",
  moduleImported: false, nativeRoutingExecuted: false,
}
mkdirSync(outputDirectory, { recursive: true })
writeFileSync(resolve(outputDirectory, "a01-source-mapping.json"), JSON.stringify(proof, null, 2) + "\n")
console.log(JSON.stringify({ passed: true, candidateAutorouterSha256: proof.candidateAutorouterSha256, sourceCandidateCommit: proof.source.candidateCommit, replacedDeclarations: 1, insertedDeclarations: 0, nativeRoutingExecuted: false }))
