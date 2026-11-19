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
assert.equal(Bun.version, "1.4.3")
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


// Exact npm AR1133 identities; execution also requires reviewed source handoffs.
const tinyBase="f1fe8edcfb3dfde8fd644d09d81bad18743144b3"
const arBase="a4f2778cb40bbc9c147b95a4e48ef0b32f1dd08f"
const repositories:any[]=[
 {repository:"tscircuit/tiny-hypergraph",root:tinyRoot,sourceBaseCommit:tinyBase,publishedBaseCommit:tinyBase,productionPatchFile:"tiny-physical-port-capacity-production.patch",changedFiles:[]},
 {repository:"tscircuit/tscircuit-autorouter",root:arRoot,sourceBaseCommit:arBase,publishedBaseCommit:arBase,productionPatchFile:"autorouter-physical-port-capacity-production.patch",changedFiles:[]},
]
const definitions:any[]=[
 {repository:repositories[0],relative:"lib/DuplicateCongestedPortSolver.ts",sourcePath:"../node_modules/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts",className:"DuplicateCongestedPortSolver",memberName:"duplicateCongestedPorts",insertedHelper:"getSharedBoundaryLength"},
 {repository:repositories[1],relative:"lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts",sourcePath:"../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts",className:"TinyHypergraphPortPointPathingSolver",memberName:"constructor"},
 {repository:repositories[1],relative:"lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts",sourcePath:"../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts",className:"AutoroutingPipelineSolver9_PreloadedTraceGraph",pipelineCallback:true},
 {repository:repositories[1],relative:"lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types.ts",typeOnly:true},
]
const publishedClassByIdentity=(definition:any):any=>{
 const candidates:any[]=[]
 for(const statement of publishedFile.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
  const cls=declaration.initializer;if(!cls||!ts.isClassExpression(cls))continue
  const solverName=cls.members.find((n:any)=>n.name?.getText(publishedFile)==="getSolverName")
  const match=definition.className==="DuplicateCongestedPortSolver"?cls.members.some((n:any)=>n.name?.getText(publishedFile)==="duplicateCongestedPorts"):solverName?.getText(publishedFile).includes(JSON.stringify(definition.className))
  if(match)candidates.push({declaration,cls})
 }
 assert.equal(candidates.length,1,definition.className)
 return candidates[0]
}
const stepCallback=(cls:any,file:any):any=>{
 const definition=member(cls,"pipelineDef");assert(ts.isArrayLiteralExpression(definition.initializer))
 const calls=definition.initializer.elements.filter((n:any)=>ts.isCallExpression(n)&&n.arguments[0]?.text==="portPointPathingSolver")
 assert.equal(calls.length,1);assert.equal(calls[0].arguments.length,3)
 const callback=calls[0].arguments[2];assert(ts.isArrowFunction(callback));return callback
}
const runtimeTokens=(text:string):string=>JSON.stringify(lexicalTokens(transpiler.transformSync(text)).map(({kind,text})=>[kind,text]))
const expressionCompiled=(node:any,file:any):string=>{
 const emitted=parse(transpiler.transformSync(`const Qualified=${node.getText(file)};`))
 return variable(emitted,"Qualified").initializer.getText(emitted)
}
const records:any[]=[]
for(const definition of definitions){
 const before=git(definition.repository.root,["show",`${definition.repository.sourceBaseCommit}:${definition.relative}`])
 const after=readFileSync(join(definition.repository.root,definition.relative),"utf8")
 if(!definition.typeOnly){
  const indexes=sourceMap.sources.flatMap((name:string,index:number)=>name===definition.sourcePath?[index]:[])
  assert.equal(indexes.length,1,definition.sourcePath);assert.equal(before,sourceMap.sourcesContent[indexes[0]],definition.relative)
 }
 const sourceHandoff=handoff.repositories.find((row:any)=>row.baseCommit===definition.repository.sourceBaseCommit)
 assert(sourceHandoff)
 assert.equal(git(definition.repository.root,["rev-parse","HEAD"]).trim(),sourceHandoff.candidateCommit??sourceHandoff.baseCommit)
 assert.equal(sha(after),sourceHandoff.files.find((row:any)=>row.path===definition.relative&&row.production)?.sha256)
 if(!allowDraft)assert.equal(git(definition.repository.root,["status","--porcelain","--",definition.relative]).trim(),"")
 const checked=programFor(after),record:any={...definition,before,after,beforeFile:parse(before),afterFile:checked.file,checker:checked.checker,aliases:{}}
 definition.repository.changedFiles.push({relative:definition.relative,beforeSha256:sha(before),afterSha256:sha(after)})
 if(definition.typeOnly){assert.equal(runtimeTokens(before),runtimeTokens(after),"Hg option changes must be type-only");records.push(record);continue}
 record.baseClass=sourceClass(record.beforeFile,definition.className);record.candidateClass=sourceClass(record.afterFile,definition.className)
 const published=publishedClassByIdentity(definition);record.publishedClass=published.cls;record.publishedDeclaration=published.declaration
 record.baseSelected=definition.pipelineCallback?stepCallback(record.baseClass,record.beforeFile):member(record.baseClass,definition.memberName)
 record.candidateSelected=definition.pipelineCallback?stepCallback(record.candidateClass,record.afterFile):member(record.candidateClass,definition.memberName)
 record.publishedSelected=definition.pipelineCallback?stepCallback(record.publishedClass,publishedFile):member(record.publishedClass,definition.memberName)
 const outside=(file:any,selected:any,candidate:boolean):string=>{
  const edits=[{start:selected.getStart(file),end:selected.end,replacement:definition.pipelineCallback?"()=>[]":""}]
  if(candidate&&definition.insertedHelper){const stmt=variable(file,definition.insertedHelper).parent.parent;assert.equal(stmt.declarationList.declarations.length,1);edits.push({start:stmt.getStart(file),end:stmt.end,replacement:""})}
  let text=file.text;for(const edit of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.replacement+text.slice(edit.end)
  return runtimeTokens(text)
 }
 assert.equal(outside(record.beforeFile,record.baseSelected,false),outside(record.afterFile,record.candidateSelected,true),`Unrelated runtime source changed: ${definition.relative}`)
 records.push(record)
}
const tiny=records[0],adapter=records[1],pipeline=records[2]
assert(!tiny.candidateSelected.getText(tiny.afterFile).includes("sourcePort.d?.cramped"),"This count-only candidate must not stack the separate #274 cramped guard")
const orderHelperRelative="lib/selective-rerip-tiny-hyper-graph-solver.ts"
const orderHelperSource=git(tinyRoot,["show",`${tinyBase}:${orderHelperRelative}`])
const orderHelperIndex=sourceMap.sources.indexOf(`../node_modules/tiny-hypergraph/${orderHelperRelative}`)
assert(orderHelperIndex>=0);assert.equal(orderHelperSource,sourceMap.sourcesContent[orderHelperIndex])
const orderHelperFile=parse(orderHelperSource)
const orderHelpers=orderHelperFile.statements.filter((node:any)=>ts.isFunctionDeclaration(node)&&node.name?.text==="orderConnectionsByNetCardinality")
assert.equal(orderHelpers.length,1)
const orderHelperText=orderHelpers[0].getText(orderHelperFile)
assert(orderHelperText.startsWith("export function "))
adapter.externalPrelude=transpiler.transformSync(orderHelperText.replace(/^export /,""))
const preludeFor=(record:any,names:string[],candidate=false):string=>transpiler.transformSync(names.map(name=>{
 const file=candidate?record.afterFile:record.beforeFile,node=variable(file,name)
 return `const ${candidate?renameNode(record,node,record.aliases):node.getText(file)};`
}).join("\n"))
tiny.helpers=["groupPortsByBoundary"]
adapter.helpers=["getTinyRouteConnectionsOrThrow","capturePreloadedTraceSegmentBaseline","getTinyHyperGraphPipelineInput","buildInputNodesWithPortPoints","TRACE_DENSITY_PORTFOLIO_MIN_ROUTE_COUNT","TRACE_DENSITY_PORTFOLIO_MAX_ROUTE_COUNT"]
for(const record of [tiny,adapter,pipeline]){
 const prelude=(record.externalPrelude??"")+preludeFor(record,record.helpers??[])
 const baseCompiled=record.pipelineCallback?expressionCompiled(record.baseSelected,record.beforeFile):compileMember(record.baseSelected.getText(record.beforeFile))
 const baseCanonical=await canonical(baseCompiled,!!record.pipelineCallback,prelude)
 const publishedCanonical=await canonical(record.publishedSelected.getText(publishedFile),!!record.pipelineCallback)
 const aliases=deriveAliases(baseCanonical,publishedCanonical,record.className)
 mergeAliases(record.aliases,aliases);record.qualification={baseCanonical,publishedCanonical,aliases}
}
// The published bounds reader is inlined inside getRegionCenter. Qualify the
// entire unchanged helper chain, retaining exact source logic and external names.
const helperQualifications:any[]=[]
for(const spec of [
 {name:"getDuplicateDirection",publishedName:tiny.aliases.getDuplicateDirection,prelude:["getFallbackBoundaryDirection"]},
 {name:"getRegionCenter",publishedName:null,prelude:["getRegionBounds"]},
]){
 const publishedName=spec.publishedName??tiny.aliases.getRegionCenter
 assert(publishedName)
 const baseCanonical=await canonical(expressionCompiled(variable(tiny.beforeFile,spec.name).initializer,tiny.beforeFile),true,preludeFor(tiny,spec.prelude))
 const publishedCanonical=await canonical(variable(publishedFile,publishedName).initializer.getText(publishedFile),true)
 const aliases=deriveAliases(baseCanonical,publishedCanonical,`unchanged ${spec.name}`)
 mergeAliases(tiny.aliases,aliases)
 helperQualifications.push({name:spec.name,publishedName,compiledBaseEquivalent:true,sourceSha256:sha(variable(tiny.beforeFile,spec.name).getText(tiny.beforeFile)),sourceDependencies:spec.prelude,aliases,baseCanonicalSha256:sha(baseCanonical),publishedCanonicalSha256:sha(publishedCanonical)})
}
const insertedHelper="getSharedBoundaryLength"
assert(!original.includes(insertedHelper),"The one inserted pure helper name must be unique")
tiny.aliases[insertedHelper]=insertedHelper
const helperFile=parse(transpiler.transformSync(`const ${renameNode(tiny,variable(tiny.afterFile,insertedHelper),tiny.aliases)};`))
const helperExpression=variable(helperFile,insertedHelper).initializer
assert(ts.isArrowFunction(helperExpression)&&ts.isBlock(helperExpression.body))
const boundsLocal=transpiler.transformSync(`const ${renameNode(tiny,variable(tiny.afterFile,"getRegionBounds"),tiny.aliases)};`)
const helperStart=helperExpression.getStart(helperFile),bodyStart=helperExpression.body.getStart(helperFile)-helperStart
const helperOriginal=helperExpression.getText(helperFile)
const localizedHelper=helperOriginal.slice(0,bodyStart+1)+boundsLocal+helperOriginal.slice(bodyStart+1)
const emittedHelperFile=parse(await canonical(localizedHelper,true))
assert.equal(emittedHelperFile.statements.length,1)
const emittedHelper=variable(emittedHelperFile,"Qualified").initializer.getText(emittedHelperFile)
const spans:any[]=[]
const addSpan=(record:any,name:string,node:any,replacementText:string,insertion=false):void=>{
 const startCharacter=node.getStart(publishedFile),endCharacter=insertion?startCharacter:node.end,originalText=original.slice(startCharacter,endCharacter)
 spans.push({kind:insertion?"insert":"replace",name,sourceRepository:record.repository.repository,sourceRelative:record.relative,
  startCharacter,endCharacter,startByte:Buffer.byteLength(original.slice(0,startCharacter)),endByte:Buffer.byteLength(original.slice(0,endCharacter)),
  originalText,replacementText,originalSha256:sha(originalText),replacementSha256:sha(replacementText),compiledBaseEquivalent:insertion?null:true,
  ...(insertion?{}:{baseCanonicalSha256:sha(record.qualification.publishedCanonical),aliases:record.qualification.aliases})})
}
addSpan(tiny,insertedHelper,tiny.publishedDeclaration,`${insertedHelper}=${emittedHelper},`,true)
for(const record of [tiny,adapter,pipeline]){
 const renamed=renameNode(record,record.candidateSelected,record.aliases)
 const callbackFile=record.pipelineCallback?parse(`const Qualified=${renamed};`):undefined
 const compiled=record.pipelineCallback?expressionCompiled(variable(callbackFile,"Qualified").initializer,callbackFile):compileMember(renamed)
 const emitted=parse(await canonical(compiled,!!record.pipelineCallback,(record.externalPrelude??"")+preludeFor(record,record.helpers??[],true)))
 assert.equal(emitted.statements.length,1,`Source-local helpers must inline within ${record.className}`)
 const replacementText=record.pipelineCallback?variable(emitted,"Qualified").initializer.getText(emitted):member(sourceClass(emitted,"Qualified"),record.memberName).getText(emitted)
 addSpan(record,record.pipelineCallback?`${record.className}.pipelineDef.portPointPathingSolver`:`${record.className}.${record.memberName}`,record.publishedSelected,replacementText)
}
spans.sort((a,b)=>a.startCharacter-b.startCharacter||(a.kind==="insert"?-1:1))
assert.equal(spans.filter(s=>s.kind==="replace").length,3);assert.equal(spans.filter(s=>s.kind==="insert").length,1)
let cursor=0,candidate="";const unchangedSegments:any[]=[]
for(const span of spans){
 assert(span.startCharacter>=cursor)
 const unchanged=original.slice(cursor,span.startCharacter)
 if(unchanged.length)unchangedSegments.push({startByte:Buffer.byteLength(original.slice(0,cursor)),endByte:span.startByte,candidateStartByte:Buffer.byteLength(candidate),candidateEndByte:Buffer.byteLength(candidate+unchanged),sha256:sha(unchanged)})
 candidate+=unchanged+span.replacementText;cursor=span.endCharacter
}
const tail=original.slice(cursor)
if(tail.length)unchangedSegments.push({startByte:Buffer.byteLength(original.slice(0,cursor)),endByte:Buffer.byteLength(original),candidateStartByte:Buffer.byteLength(candidate),candidateEndByte:Buffer.byteLength(candidate+tail),sha256:sha(tail)})
candidate+=tail;parse(candidate)
for(const segment of unchangedSegments)assert.equal(sha(Buffer.from(candidate).subarray(segment.candidateStartByte,segment.candidateEndByte)),segment.sha256)
const source={repositories:repositories.map(({root,...repository})=>{
 const files=repository.changedFiles.map((row:any)=>row.relative),patch=git(root,["diff","--binary",repository.sourceBaseCommit,"--",...files])
 const candidateCommit=git(root,["status","--porcelain","--",...files]).trim()?null:git(root,["rev-parse","HEAD"]).trim()
 const sourceHandoff=handoff.repositories.find((row:any)=>row.baseCommit===repository.sourceBaseCommit)
 assert.equal(candidateCommit,sourceHandoff.candidateCommit);assert.equal(sha(patch),sourceHandoff.patches.production.sha256);assert(allowDraft||candidateCommit)
 writeFileSync(join(outDir,repository.productionPatchFile),patch)
 return{...repository,candidateCommit,productionPatchSha256:sha(patch)}
})}
const mapping={schemaVersion:2,passed:true,sourceFrozen:!allowDraft,originalAutorouterSha256:sha(original),candidateAutorouterSha256:sha(candidate),sourceMapSha256:sha(sourceMapText),source,
 spans,unchangedSegments,qualification:{allOutsideBytesUnchanged:true,unrelatedSourceRuntimeUnchanged:true,compiledBaseEquivalent:true,sourceMapGeneratedOffsetsUsed:false,
  typeErasure:"TypeScript5.9.3 transpileModule targeting ESNext; no Bun syntax optimization",
  canonicalizer:"Terser5.51.2 three compression passes and deterministic lexical names; differing free bindings mapped bijectively; properties and local bindings must match exactly",
  sourceAliases:records.filter(r=>!r.typeOnly).map(r=>({relative:r.relative,aliases:r.aliases})),unchangedHelperQualification:helperQualifications,
  unchangedImportedHelper:{name:"orderConnectionsByNetCardinality",relative:orderHelperRelative,sourceBaseCommit:tinyBase,sourceMapIndex:orderHelperIndex,sourceFileSha256:sha(orderHelperSource),declarationSha256:sha(orderHelperText),qualification:"Included unchanged in complete adapter constructor baseline equivalence"},
  localizedUnchangedBoundsReader:{name:"getRegionBounds",sourceSha256:sha(variable(tiny.beforeFile,"getRegionBounds").getText(tiny.beforeFile)),scope:"Pure unchanged bounds reader is declared inside the inserted shared-boundary helper; no global state"},
  bun:Bun.version,typescript:ts.version,terser:require("terser/package.json").version},sourceHandoffSha256:sha(handoffText),mapperSha256:sha(readFileSync(import.meta.path)),moduleImported:false,nativeRoutingExecuted:false}
mkdirSync(join(outDir,"dist"),{recursive:true})
writeFileSync(join(outDir,"dist/physical-port-capacity-candidate.js"),candidate)
writeFileSync(join(outDir,"physical-port-capacity-source-mapping.json"),JSON.stringify(mapping,null,2)+"\n")
console.log(JSON.stringify({passed:true,replacements:3,insertions:1,candidateAutorouterSha256:mapping.candidateAutorouterSha256,source,nativeRoutingExecuted:false}))
