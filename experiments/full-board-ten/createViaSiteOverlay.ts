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
const handoffText = ""
mkdirSync(outDir, { recursive: true })
const git = (root: string, args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } })
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


const tinyBase='f1fe8edcfb3dfde8fd644d09d81bad18743144b3'
const tinyCommit='6a00f0406e131a2765179e052e45f07efd2f5ae7'
const arBase='a4f2778cb40bbc9c147b95a4e48ef0b32f1dd08f'
const arCommit=git(arRoot,['rev-parse','HEAD']).trim()
const records:any[]=[]
function record(root:string,base:string,commit:string,relative:string,sourcePath:string){
 const before=git(root,['show',`${base}:${relative}`]),after=git(root,['show',`${commit}:${relative}`])
 const index=sourceMap.sources.indexOf(sourcePath)
 assert(index>=0,sourcePath);assert.equal(sourceMap.sourcesContent[index],before)
 const checked=programFor(after)
 const r={root,base,commit,relative,sourcePath,before,after,beforeFile:parse(before),afterFile:checked.file,checker:checked.checker,aliases:{},selections:[]};records.push(r);return r
}
function selectVar(r:any,name:string,pub:string,helpers:string[]=[]){r.selections.push({name,kind:'expression',base:variable(r.beforeFile,name).initializer,candidate:variable(r.afterFile,name).initializer,published:variable(publishedFile,pub).initializer,helpers})}
function selectMember(r:any,cls:string,pub:string,name:string){r.selections.push({name:`${cls}.${name}`,memberName:name,kind:'member',base:member(sourceClass(r.beforeFile,cls),name),candidate:member(sourceClass(r.afterFile,cls),name),published:member(publishedClass(pub),name),helpers:[]})}
const costs=record(tinyRoot,tinyBase,tinyCommit,'lib/computeRegionCost.ts','../node_modules/tiny-hypergraph/lib/computeRegionCost.ts')
selectVar(costs,'computeRegionCost','hJ',['DEFAULT_MIN_VIA_PAD_DIAMETER'])
selectVar(costs,'computeRegionCostForArea','dJ',['DEFAULT_MIN_VIA_PAD_DIAMETER','TRACE_VIA_MARGIN','traceWidth','IMPOSSIBLE_SINGLE_LAYER_INTERSECTION_COST'])
const loader=record(tinyRoot,tinyBase,tinyCommit,'lib/compat/loadSerializedHyperGraph.ts','../node_modules/tiny-hypergraph/lib/compat/loadSerializedHyperGraph.ts')
selectVar(loader,'loadSerializedHyperGraph','oK',['getRegionGeometry','getRegionAvailableZMask','getSerializedPortZ','addSerializedRegionIdToMetadata','addSerializedPortIdToMetadata','getSharedPortIdsForConnection'])
const core=record(tinyRoot,tinyBase,tinyCommit,'lib/core.ts','../node_modules/tiny-hypergraph/lib/core.ts')
selectMember(core,'TinyHyperGraphSolver','PQ','computeRegionCostForRegion')
const dense=record(tinyRoot,tinyBase,tinyCommit,'lib/prepared/DenseRoutingWorkspace.ts','../node_modules/tiny-hypergraph/lib/prepared/DenseRoutingWorkspace.ts')
selectMember(dense,'DenseRoutingWorkspace','XQ','expand')
const adapter=record(arRoot,arBase,arCommit,'lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts','../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts')
selectVar(adapter,'toSerializedRegionData','v0')
const pipeline=record(arRoot,arBase,arCommit,'lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts','../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts')
function callback(cls:any,file:any){const def=member(cls,'pipelineDef');const calls=def.initializer.elements.filter(n=>ts.isCallExpression(n)&&n.arguments[0]?.text==='nodeDimensionSubdivisionSolver');assert.equal(calls.length,1);const props=calls[0].arguments[3].properties.filter(p=>p.name?.text==='onSolved');assert.equal(props.length,1);return props[0].initializer}
pipeline.selections.push({name:'Pipeline9.nodeDimensionSubdivisionSolver.onSolved',kind:'expression',base:callback(sourceClass(pipeline.beforeFile,'AutoroutingPipelineSolver9_PreloadedTraceGraph'),pipeline.beforeFile),candidate:callback(sourceClass(pipeline.afterFile,'AutoroutingPipelineSolver9_PreloadedTraceGraph'),pipeline.afterFile),published:callback(publishedClass('Kse'),publishedFile),helpers:[]})
const expressionCompiled=(node:any,file:any)=>{const emitted=parse(transpiler.transformSync(`const Qualified=${node.getText(file)};`));return variable(emitted,'Qualified').initializer.getText(emitted)}
const preludeFor=(r:any,names:string[],after=false)=>transpiler.transformSync(names.map(name=>`const ${variable(after?r.afterFile:r.beforeFile,name).getText(after?r.afterFile:r.beforeFile)};`).join('\n'))
for(const r of records)for(const s of r.selections){
 const prelude=preludeFor(r,s.helpers)
 const b=s.kind==='expression'?expressionCompiled(s.base,r.beforeFile):compileMember(s.base.getText(r.beforeFile))
 const bc=await canonical(b,s.kind==='expression',prelude),pc=await canonical(s.published.getText(publishedFile),s.kind==='expression')
 const aliases=deriveAliases(bc,pc,s.name);mergeAliases(r.aliases,aliases);s.qualification={baseCanonical:bc,publishedCanonical:pc,aliases};console.log(`Qualified ${s.name}`)
}
console.log(JSON.stringify(records.map(r=>({relative:r.relative,aliases:r.aliases})),null,2))
// Existing local geometry helpers were inlined in the published regional guard.
// Verify those exact expressions before making the newly exported source helpers
// available to the new via-site function.
const regionalRelative='lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver.ts'
const regional=record(arRoot,arBase,arCommit,regionalRelative,'../'+regionalRelative)
const publishedGuard=variable(publishedFile,'Ire').initializer
const arrows:any[]=[]
function collectArrows(n:any){if(ts.isArrowFunction(n))arrows.push(n);ts.forEachChild(n,collectArrows)}
collectArrows(publishedGuard)
const geometrySpecs=[
 {name:'getPointToObstacleDistance',filter:(s:string)=>s.includes('ccwRotationDegrees')&&s.includes('Math.hypot')},
 {name:'getObstacleZLayers',filter:(s:string)=>s.includes('__zLayers')},
]
const geometryProof:any[]=[]
for(const spec of geometrySpecs){
 const b=variable(regional.beforeFile,spec.name).initializer,a=variable(regional.afterFile,spec.name).initializer
 assert.equal(transpiler.transformSync(`const X=${b.getText(regional.beforeFile)}`),transpiler.transformSync(`const X=${a.getText(regional.afterFile)}`))
 const candidates=arrows.filter(n=>spec.filter(n.getText(publishedFile))).sort((a,b)=>(a.end-a.pos)-(b.end-b.pos));assert(candidates.length)
 const published=candidates[0],bc=await canonical(expressionCompiled(b,regional.beforeFile),true),pc=await canonical(published.getText(publishedFile),true)
 const aliases=deriveAliases(bc,pc,spec.name);mergeAliases(regional.aliases,aliases)
 geometryProof.push({name:spec.name,publishedContainer:'Ire',sourceSha256:sha(b.getText(regional.beforeFile)),publishedExpressionSha256:sha(published.getText(publishedFile)),aliases})
}
const clearanceRelative='lib/utils/getViaToPadClearance.ts',clearanceBefore=git(arRoot,['show',`${arBase}:${clearanceRelative}`])
assert.equal(clearanceBefore,git(arRoot,['show',`${arCommit}:${clearanceRelative}`]))
assert.equal(clearanceBefore,sourceMap.sourcesContent[sourceMap.sources.indexOf('../'+clearanceRelative)])
const clearanceFile=parse(clearanceBefore)
deriveAliases(await canonical(expressionCompiled(variable(clearanceFile,'getViaToPadClearance').initializer,clearanceFile),true),await canonical(variable(publishedFile,'x7').initializer.getText(publishedFile),true),'getViaToPadClearance')
const helperRelative='lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/markNodesWithoutViaSite.ts'
const helperSource=git(arRoot,['show',`${arCommit}:${helperRelative}`]),helperFile=parse(helperSource)
assert(!sourceMap.sources.includes('../'+helperRelative))
assert(!original.includes('__viaSiteMarkNodesWithoutViaSite'))
const helperStatements=helperFile.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(helperFile).replace(/^export\s+/,''))
const geometryStatements=geometrySpecs.map(s=>`const ${s.name}=${renameNode(regional,variable(regional.afterFile,s.name).initializer,regional.aliases)};`)
const helperExpression=transpiler.transformSync(`const Qualified=(()=>{${geometryStatements.join('\n')}\n${helperStatements.join('\n')}\nreturn markNodesWithoutViaSite;})();`)
const helperEmitted=parse(helperExpression),helperText=variable(helperEmitted,'Qualified').initializer.getText(helperEmitted)
assert.deepEqual([...new Set(lexicalTokens(`const Qualified=${helperText};`).filter(t=>t.free).map(t=>t.text))].sort(),['Math','Set','mo'],'New helper may reference only source-proven mapLayerNameToZ and standard globals')
pipeline.aliases.markNodesWithoutViaSite='__viaSiteMarkNodesWithoutViaSite';pipeline.aliases.getViaToPadClearance='x7'
function candidatePrelude(r:any,s:any){const names=[...s.helpers];if(r===loader)names.push('getRegionViaAreaFraction');if(r===adapter)names.push('NO_VIA_SITE_AREA_FRACTION');return transpiler.transformSync(names.map(name=>`const ${renameNode(r,variable(r.afterFile,name),r.aliases)};`).join('\n'))}
const spans:any[]=[]
for(const r of records)for(const s of r.selections){
 const renamed=renameNode(r,s.candidate,r.aliases),f=s.kind==='expression'?parse(`const Qualified=${renamed}`):null
 const compiled=s.kind==='expression'?expressionCompiled(variable(f,'Qualified').initializer,f):compileMember(renamed)
 const emitted=parse(await canonical(compiled,s.kind==='expression',candidatePrelude(r,s)))
 assert.equal(emitted.statements.length,1,s.name)
 const replacementText=s.kind==='expression'?variable(emitted,'Qualified').initializer.getText(emitted):member(sourceClass(emitted,'Qualified'),s.memberName).getText(emitted)
 const startCharacter=s.published.getStart(publishedFile),endCharacter=s.published.end,originalText=original.slice(startCharacter,endCharacter)
 spans.push({kind:'replace',name:s.name,sourceRepository:r.root===tinyRoot?'tscircuit/tiny-hypergraph':'tscircuit/tscircuit-autorouter',sourceRelative:r.relative,startCharacter,endCharacter,startByte:Buffer.byteLength(original.slice(0,startCharacter)),endByte:Buffer.byteLength(original.slice(0,endCharacter)),originalText,replacementText,originalSha256:sha(originalText),replacementSha256:sha(replacementText),compiledBaseEquivalent:true,baseCanonicalSha256:sha(s.qualification.publishedCanonical),aliases:s.qualification.aliases})
}
const cls=variable(publishedFile,'Kse');let statement=cls;while(!ts.isSourceFile(statement.parent))statement=statement.parent
const anchor=statement.getStart(publishedFile),insertion=`var __viaSiteMarkNodesWithoutViaSite=${helperText};\n`
spans.push({kind:'insert',name:'markNodesWithoutViaSite with newly exported existing geometry helpers',sourceRepository:'tscircuit/tscircuit-autorouter',sourceRelative:helperRelative,startCharacter:anchor,endCharacter:anchor,startByte:Buffer.byteLength(original.slice(0,anchor)),endByte:Buffer.byteLength(original.slice(0,anchor)),originalText:'',replacementText:insertion,originalSha256:sha(''),replacementSha256:sha(insertion),compiledBaseEquivalent:null,geometryProof})
spans.sort((a,b)=>a.startCharacter-b.startCharacter||(a.kind==='insert'?-1:1))
let cursor=0,candidate='';const unchangedSegments:any[]=[]
for(const span of spans){assert(span.startCharacter>=cursor);const text=original.slice(cursor,span.startCharacter);if(text.length)unchangedSegments.push({startByte:Buffer.byteLength(original.slice(0,cursor)),endByte:span.startByte,candidateStartByte:Buffer.byteLength(candidate),candidateEndByte:Buffer.byteLength(candidate+text),sha256:sha(text)});candidate+=text+span.replacementText;cursor=span.endCharacter}
const tail=original.slice(cursor);unchangedSegments.push({startByte:Buffer.byteLength(original.slice(0,cursor)),endByte:Buffer.byteLength(original),candidateStartByte:Buffer.byteLength(candidate),candidateEndByte:Buffer.byteLength(candidate+tail),sha256:sha(tail)});candidate+=tail;parse(candidate)
for(const segment of unchangedSegments)assert.equal(sha(Buffer.from(candidate).subarray(segment.candidateStartByte,segment.candidateEndByte)),segment.sha256)
// Every executable source change must be accounted for above. Ignore only imports,
// exports, added declarations compiled into a selected expression, and erased types.
function outside(r:any,after:boolean){const file=after?r.afterFile:r.beforeFile;const edits:any[]=[];for(const s of r.selections){const n=after?s.candidate:s.base;edits.push({start:n.getStart(file),end:n.end,text:s.kind==='expression'?'undefined':''})}
 const added=after?(r===loader?['getRegionViaAreaFraction']:r===adapter?['NO_VIA_SITE_AREA_FRACTION']:[]):[]
 for(const n of file.statements){if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))edits.push({start:n.getStart(file),end:n.end,text:''});if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>added.includes(d.name.text)))edits.push({start:n.getStart(file),end:n.end,text:''})}
 let text=file.text;for(const e of edits.sort((a,b)=>b.start-a.start))text=text.slice(0,e.start)+e.text+text.slice(e.end)
 return lexicalTokens(transpiler.transformSync(text).replaceAll(/\bexport\s+/g,'')).map(x=>[x.kind,x.text])}
for(const r of records)assert.deepEqual(outside(r,false),outside(r,true),`Unmapped source changes ${r.relative}`)
const arFiles=[...records.filter(r=>r.root===arRoot).map(r=>r.relative),helperRelative,'lib/types/capacity-mesh-types.ts','package.json']
assert.equal(transpiler.transformSync(git(arRoot,['show',`${arBase}:lib/types/capacity-mesh-types.ts`])),transpiler.transformSync(git(arRoot,['show',`${arCommit}:lib/types/capacity-mesh-types.ts`])),'Node flag declaration must be type-only')
const tinyFiles=[...records.filter(r=>r.root===tinyRoot).map(r=>r.relative),'lib/poly.ts']
const polyPath='../node_modules/tiny-hypergraph/lib/poly.ts';assert(!sourceMap.sources.includes(polyPath));assert(sourceMap.sources.includes('../node_modules/tiny-hypergraph-poly/lib/poly.ts'))
const lane=arCommit==='6dd514c6f8a8624deec3ebc6e6db4f806cd797ca'?'feature-base':'bounds-fix';assert(lane==='feature-base'||arCommit==='f362c3ab026c8498c9ccb4ed1b1144f650ee187a')
const repositories=[]
for(const [name,root,base,commit,files]of[['tscircuit/tiny-hypergraph',tinyRoot,tinyBase,tinyCommit,tinyFiles],['tscircuit/tscircuit-autorouter',arRoot,arBase,arCommit,arFiles]]as any[]){
 const patch=git(root,['diff','--binary',base,commit,'--',...files]),productionPatchFile=`${lane}/${name==='tscircuit/tiny-hypergraph'?'tiny-via-site':'autorouter-production'}.patch`
 writeFileSync(join(outDir,productionPatchFile.split('/').at(-1)),patch)
 const changedFiles=files.map(relative=>{let before=null;try{before=git(root,['show',`${base}:${relative}`])}catch{}const after=git(root,['show',`${commit}:${relative}`]);return{relative,beforeSha256:before===null?null:sha(before),afterSha256:sha(after),...(before===null?{newFile:true}:{}),...(relative==='lib/poly.ts'?{runtimeAbsent:true,reason:'Regular Tiny poly module is not in published graph; separate tiny-hypergraph-poly pin untouched'}:{}),...(relative==='package.json'?{runtimeMetadataUnchanged:true}: {})}})
 repositories.push({repository:name,sourceBaseCommit:base,publishedBaseCommit:base,candidateCommit:commit,productionPatchFile,productionPatchSha256:sha(patch),changedFiles})
}
const packageBefore=JSON.parse(git(arRoot,['show',`${arBase}:package.json`])),packageAfter=JSON.parse(git(arRoot,['show',`${arCommit}:package.json`]));assert.equal(packageAfter.devDependencies['tiny-hypergraph'],`git+https://github.com/tscircuit/tiny-hypergraph.git#${tinyCommit}`);packageAfter.devDependencies['tiny-hypergraph']=packageBefore.devDependencies['tiny-hypergraph'];assert.deepEqual(packageBefore,packageAfter)
const mapping={schemaVersion:2,passed:true,sourceFrozen:true,lane,originalAutorouterSha256:sha(original),candidateAutorouterSha256:sha(candidate),sourceMapSha256:sha(sourceMapText),source:{repositories},spans,unchangedSegments,qualification:{allOutsideBytesUnchanged:true,unrelatedSourceRuntimeUnchanged:true,compiledBaseEquivalent:true,sourceMapGeneratedOffsetsUsed:false,regularTinyOnly:true,regularTinyPolySourceAbsent:true,separateTinyPolyAliasUntouched:true,clearanceBinding:'x7',geometryProof,typeErasure:'TypeScript5.9.3 transpileModule ESNext; source helpers emitted without optimizer for exact four-bound identity',canonicalizer:'Terser5.51.2 three compression passes and deterministic lexical names; free bindings mapped bijectively',sourceAliases:records.map(r=>({relative:r.relative,aliases:r.aliases})),bun:Bun.version,typescript:ts.version,terser:require('terser/package.json').version},mapperSha256:sha(readFileSync(import.meta.path)),moduleImported:false,nativeRoutingExecuted:false}
mkdirSync(join(outDir,'dist'),{recursive:true});writeFileSync(join(outDir,'dist/via-site-candidate.js'),candidate);writeFileSync(join(outDir,'via-site-source-mapping.json'),JSON.stringify(mapping,null,2)+'\n');console.log(JSON.stringify({passed:true,lane,spans:spans.length,originalAutorouterSha256:sha(original),candidateAutorouterSha256:sha(candidate)}))
