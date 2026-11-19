import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { gunzipSync } from "node:zlib"

// Static source qualification only. The published bundle is parsed, never imported.
const [tinyRoot, entryPath, mapPath, tsPath, outDir, draftOption] = process.argv.slice(2)
const allowDraft = draftOption === "--allow-draft"
assert(draftOption === undefined || allowDraft)
assert(tinyRoot && entryPath && mapPath && tsPath && outDir)
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

const baseCommit="f1fe8edcfb3dfde8fd644d09d81bad18743144b3"
const relative="lib/DuplicateCongestedPortSolver.ts"
const className="DuplicateCongestedPortSolver",methodName="duplicateCongestedPorts"
const sourceIndex=1254,publishedAlias="xK"
const before=git(tinyRoot,["show",`${baseCommit}:${relative}`])
const after=readFileSync(join(tinyRoot,relative),"utf8")
assert.equal(sourceMap.sources[sourceIndex],"../node_modules/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts")
assert.equal(before,sourceMap.sourcesContent[sourceIndex],"Source must exactly match the published Tiny file")
const sourceHandoff=handoff.repositories[0]
assert.equal(sourceHandoff.baseCommit,baseCommit)
assert.equal(sourceHandoff.files.length,1)
assert.equal(sourceHandoff.files[0].path,relative)
assert.equal(sourceHandoff.files[0].sha256,sha(after))
assert.equal(git(tinyRoot,["rev-parse","HEAD"]).trim(),sourceHandoff.candidateCommit??baseCommit)
if(!allowDraft)assert.equal(git(tinyRoot,["status","--porcelain","--",relative]).trim(),"")
const beforeFile=parse(before),checked=programFor(after),afterFile=checked.file
const baseMethod=member(sourceClass(beforeFile,className),methodName)
const candidateMethod=member(sourceClass(afterFile,className),methodName)
const sourceOutside=(file:any,node:any):string=>file.text.slice(0,node.getStart(file))+"QUALIFIED_METHOD"+file.text.slice(node.end)
assert.equal(sourceOutside(beforeFile,baseMethod),sourceOutside(afterFile,candidateMethod),"Only the selected source method may change")
const exactGuard="      if (sourcePort.d?.cramped === true) continue\n"
assert.equal(after.split(exactGuard).length,2,"Require the one existing #274 guard exactly once")
assert.equal(after.replace(exactGuard,""),before,"Candidate must be only the existing cramped-port guard")
const publishedMethod=member(publishedClass(publishedAlias),methodName)
assert.equal(publishedMethod.parameters.length,baseMethod.parameters.length)
const helperName="groupPortsByBoundary"
const helperPrelude=transpiler.transformSync(`const ${variable(beforeFile,helperName).getText(beforeFile)};`)
const baseCompiled=compileMember(baseMethod.getText(beforeFile))
const baseCanonical=await canonical(baseCompiled,false,helperPrelude)
const publishedCanonical=await canonical(publishedMethod.getText(publishedFile))
const aliases=deriveAliases(baseCanonical,publishedCanonical,`${className}.${methodName}`)
const record={afterFile,checker:checked.checker}
const candidateHelperPrelude=transpiler.transformSync(`const ${renameNode(record,variable(afterFile,helperName),aliases)};`)
const candidateCompiled=compileMember(renameNode(record,candidateMethod,aliases))
const candidateClassFile=parse(await canonical(candidateCompiled,false,candidateHelperPrelude))
assert.equal(candidateClassFile.statements.length,1,"The source-local helper must inline without adding a global binding")
const replacementText=member(sourceClass(candidateClassFile,"Qualified"),methodName).getText(candidateClassFile)
assert.notEqual(await canonical(replacementText),publishedCanonical)
const startCharacter=publishedMethod.getStart(publishedFile),endCharacter=publishedMethod.end
const originalText=original.slice(startCharacter,endCharacter)
const startByte=Buffer.byteLength(original.slice(0,startCharacter)),endByte=Buffer.byteLength(original.slice(0,endCharacter))
const spans=[{kind:"replace",name:`${className}.${methodName}`,sourceRepository:"tscircuit/tiny-hypergraph",sourceRelative:relative,
  startCharacter,endCharacter,startByte,endByte,originalText,replacementText,originalSha256:sha(originalText),replacementSha256:sha(replacementText),
  compiledBaseEquivalent:true,baseCanonicalSha256:sha(publishedCanonical),aliases}]
const candidate=original.slice(0,startCharacter)+replacementText+original.slice(endCharacter)
parse(candidate)
const candidateReplacementEnd=startByte+Buffer.byteLength(replacementText)
const unchangedSegments=[{startByte:0,endByte:startByte,candidateStartByte:0,candidateEndByte:startByte,sha256:sha(original.slice(0,startCharacter))},
 {startByte:endByte,endByte:Buffer.byteLength(original),candidateStartByte:candidateReplacementEnd,candidateEndByte:Buffer.byteLength(candidate),sha256:sha(original.slice(endCharacter))}]
for(const segment of unchangedSegments)assert.equal(sha(Buffer.from(candidate).subarray(segment.candidateStartByte,segment.candidateEndByte)),segment.sha256)
const productionPatch=git(tinyRoot,["diff","--binary",baseCommit,"--",relative])
const candidateCommit=git(tinyRoot,["status","--porcelain","--",relative]).trim()?null:git(tinyRoot,["rev-parse","HEAD"]).trim()
assert.equal(candidateCommit,sourceHandoff.candidateCommit)
assert.equal(sha(productionPatch),sourceHandoff.patches.production.sha256)
assert(allowDraft||candidateCommit)
const productionPatchFile="tiny-cramped-port-capacity-production.patch"
const source={repositories:[{repository:"tscircuit/tiny-hypergraph",sourceBaseCommit:baseCommit,publishedBaseCommit:baseCommit,candidateCommit,
  productionPatchFile,productionPatchSha256:sha(productionPatch),changedFiles:[{relative,beforeSha256:sha(before),afterSha256:sha(after)}]}]}
const mapping={schemaVersion:2,passed:true,sourceFrozen:!allowDraft,originalAutorouterSha256:sha(original),candidateAutorouterSha256:sha(candidate),sourceMapSha256:sha(sourceMapText),source,
  spans,unchangedSegments,qualification:{allOutsideBytesUnchanged:true,unrelatedSourceRuntimeUnchanged:true,compiledBaseEquivalent:true,sourceMapGeneratedOffsetsUsed:false,
    exactExistingFix:{url:"https://github.com/tscircuit/tiny-hypergraph/pull/274",commit:"31e0f360bb4ff245a2995ed53eacfd6fc1e403a3",guard:exactGuard.trim()},
    typeErasure:"TypeScript5.9.3 transpileModule targeting ESNext; no Bun syntax optimization",
    inlinedUnchangedSourceHelper:{name:helperName,sourceSha256:sha(variable(beforeFile,helperName).getText(beforeFile)),qualification:"Compile original method plus unchanged source helper; entire canonical method equals the published method under the recorded external aliases"},
    canonicalizer:"Terser5.51.2 three compression passes and deterministic lexical names; differing free bindings mapped bijectively; properties and local bindings must match exactly",
    sourceAliases:[{relative,aliases}],bun:Bun.version,typescript:ts.version,terser:require("terser/package.json").version},
  sourceHandoffSha256:sha(handoffText),mapperSha256:sha(readFileSync(import.meta.path)),moduleImported:false,nativeRoutingExecuted:false}
mkdirSync(join(outDir,"dist"),{recursive:true})
writeFileSync(join(outDir,productionPatchFile),productionPatch)
writeFileSync(join(outDir,"dist/cramped-port-capacity-candidate.js"),candidate)
writeFileSync(join(outDir,"cramped-port-capacity-source-mapping.json"),JSON.stringify(mapping,null,2)+"\n")
console.log(JSON.stringify({passed:true,replacements:1,insertions:0,candidateAutorouterSha256:mapping.candidateAutorouterSha256,source,nativeRoutingExecuted:false}))

