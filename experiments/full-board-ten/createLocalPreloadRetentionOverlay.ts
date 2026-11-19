import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { gunzipSync } from "node:zlib"

// Static source qualification only. The published bundle is parsed, never imported.
const [arRoot, entryPath, mapPath, tsPath, outDir, draftOption] = process.argv.slice(2)
const allowDraft = draftOption === "--allow-draft"
assert(draftOption === undefined || allowDraft)
assert(arRoot && entryPath && mapPath && tsPath && outDir)
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

const baseCommit = "c0dcc07ae48b17296a1dc73678e258de62ca8de3"
const repository: any = { repository: "tscircuit/tscircuit-autorouter", sourceBaseCommit: baseCommit,
  publishedBaseCommit: baseCommit, productionPatchFile: "local-preload-retention-production.patch", changedFiles: [] }
const prefix = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/"
const definitions = [
  { relative: prefix + "pipeline9RegionalFallback.ts", sourceIndex: 1563,
    variables: ["fixedRouteSlicesAreContiguous", "createRegionalFallbackProblem"],
    removed: "getFixedRouteSlice", inserted: "getFixedRouteSlices" },
  { relative: prefix + "Pipeline9HighDensitySolver.ts", sourceIndex: 1581,
    className: "Pipeline9HighDensitySolver", publishedClassName: "Nre", methods: ["finishRegionalFallback"],
    addedImports: ["getFixedRouteSlices", "BOUNDARY_COORDINATE_TOLERANCE_MM"] },
  { relative: prefix + "applyPipeline9RegionalB01Repairs.ts", sourceIndex: 1596,
    variables: ["preparePipeline9RegularRegionalCandidate"] },
]
const publishedNames: Record<string, string> = {
  fixedRouteSlicesAreContiguous: "vie", createRegionalFallbackProblem: "Iie",
  preparePipeline9RegularRegionalCandidate: "rse",
  getNodeBounds: "fie", isPointInsideBounds: "yie", clipRouteSegmentToBounds: "bie",
  BOUNDARY_COORDINATE_TOLERANCE_MM: "Ia", POINT_EPSILON: "gie",
}
const records: any[] = []
const tokens = (text: string): string => JSON.stringify(lexicalTokens(text).map(({kind,text}) => [kind,text]))
const compileExpression = (node: any, file: any): string => {
  const emitted = parse(transpiler.transformSync(`const Qualified = ${node.getText(file)};`))
  return variable(emitted, "Qualified").initializer.getText(emitted)
}
const normalizeSourceOutside = (text: string, definition: any, candidate: boolean): string => {
  const file = parse(text), removals: any[] = []
  for (const name of definition.variables ?? []) removals.push(variable(file, name).parent.parent)
  const extra = candidate ? definition.inserted : definition.removed
  if (extra) removals.push(variable(file, extra).parent.parent)
  if (definition.className) for (const name of definition.methods) removals.push(member(sourceClass(file, definition.className), name))
  for (const node of removals) if (ts.isVariableStatement(node)) assert.equal(node.declarationList.declarations.length, 1)
  let remaining = file.text
  for (const node of removals.sort((a,b) => b.getStart(file)-a.getStart(file))) remaining = remaining.slice(0,node.getStart(file)) + remaining.slice(node.end)
  if (candidate && definition.addedImports) {
    const parsed = parse(remaining), edits: any[] = []
    const found: string[] = []
    for (const statement of parsed.statements) if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      const keep = bindings.elements.filter((item: any) => {
        if (!definition.addedImports.includes(item.name.text)) return true
        assert(!item.propertyName); found.push(item.name.text); return false
      })
      if (keep.length === bindings.elements.length) continue
      const replacement = keep.length ? `import { ${keep.map((item:any)=>item.getText(parsed)).join(", ")} } from ${statement.moduleSpecifier.getText(parsed)};` : ""
      edits.push({start:statement.getStart(parsed),end:statement.end,replacement})
    }
    assert.deepEqual(found.sort(), [...definition.addedImports].sort())
    for(const edit of edits.sort((a,b)=>b.start-a.start)) remaining=remaining.slice(0,edit.start)+edit.replacement+remaining.slice(edit.end)
  }
  let erased=transpiler.transformSync(remaining)
  const erasedFile=parse(erased)
  for(const statement of [...erasedFile.statements].reverse())if(ts.isImportDeclaration(statement)){
    const normalized=statement.getText(erasedFile).replace(/,\s*}/g,"}")
    erased=erased.slice(0,statement.getStart(erasedFile))+normalized+erased.slice(statement.end)
  }
  return tokens(erased)
}
for (const definition of definitions) {
  const before = git(arRoot, ["show", `${baseCommit}:${definition.relative}`])
  const after = readFileSync(join(arRoot, definition.relative), "utf8")
  assert.equal(before, sourceMap.sourcesContent[definition.sourceIndex], definition.relative)
  const sourceHandoff = handoff.repositories[0]
  assert.equal(sourceHandoff.baseCommit, baseCommit)
  assert.equal(sha(after), sourceHandoff.files.find((row:any)=>row.path===definition.relative&&row.production)?.sha256)
  assert.equal(git(arRoot,["rev-parse","HEAD"]).trim(), sourceHandoff.candidateCommit ?? baseCommit)
  if(!allowDraft) assert.equal(git(arRoot,["status","--porcelain","--",definition.relative]).trim(),"")
  const checked = programFor(after)
  const record:any = {...definition, before, after, beforeFile:parse(before), afterFile:checked.file,checker:checked.checker,aliases:{},qualifications:[],repository}
  const baseOutside=normalizeSourceOutside(before,definition,false),candidateOutside=normalizeSourceOutside(after,definition,true)
  if(baseOutside!==candidateOutside){
    const left=JSON.parse(baseOutside),right=JSON.parse(candidateOutside),index=left.findIndex((v:any,i:number)=>JSON.stringify(v)!==JSON.stringify(right[i]))
    console.log(JSON.stringify({scopeMismatch:definition.relative,index,left:left.slice(Math.max(0,index-4),index+12),right:right.slice(Math.max(0,index-4),index+12)}))
  }
  assert(baseOutside===candidateOutside,`Unrelated runtime source changed: ${definition.relative}`)
  repository.changedFiles.push({relative:definition.relative,beforeSha256:sha(before),afterSha256:sha(after)})
  records.push(record)
}
const helpers = records[0], hd = records[1], regular = records[2]
const sharedAliases: Record<string,string> = {}
const unchangedHelperQualification: any[] = []
for(const name of ["getNodeBounds","isPointInsideBounds","clipRouteSegmentToBounds"]) {
  const baseNode=variable(helpers.beforeFile,name).initializer, afterNode=variable(helpers.afterFile,name).initializer
  assert.equal(tokens(baseNode.getText(helpers.beforeFile)),tokens(afterNode.getText(helpers.afterFile)))
  const baseCanonical=await canonical(compileExpression(baseNode,helpers.beforeFile),true)
  const publishedCanonical=await canonical(variable(publishedFile,publishedNames[name]).initializer.getText(publishedFile),true)
  const aliases=deriveAliases(baseCanonical,publishedCanonical,`unchanged ${name}`)
  mergeAliases(sharedAliases,aliases)
  sharedAliases[name]=publishedNames[name]
  unchangedHelperQualification.push({name,publishedName:publishedNames[name],compiledBaseEquivalent:true,baseCanonicalSha256:sha(baseCanonical),publishedCanonicalSha256:sha(publishedCanonical),aliases})
}
const toleranceFile=parse(sourceMap.sourcesContent[201])
assert.equal(variable(toleranceFile,"BOUNDARY_COORDINATE_TOLERANCE_MM").initializer.getText(toleranceFile),"1e-6")
assert.equal(variable(publishedFile,"Ia").initializer.getText(publishedFile),"1e-6")
sharedAliases.BOUNDARY_COORDINATE_TOLERANCE_MM="Ia"
assert.equal(variable(helpers.beforeFile,"POINT_EPSILON").initializer.getText(helpers.beforeFile),"1e-9")
assert.equal(variable(publishedFile,"gie").initializer.getText(publishedFile),"1e-9")
sharedAliases.POINT_EPSILON="gie"

// Qualify each immediate helper body independently; normalize only its callee
// expression in the outer comparison. Published call arguments/order are retained.
const inlineCallees:any[]=[]
const publishedRegional=variable(publishedFile,"Iie")
const visitCalls=(node:any):void=>{
  if(ts.isCallExpression(node)){
    let expression=node.expression
    while(ts.isParenthesizedExpression(expression))expression=expression.expression
    if(ts.isArrowFunction(expression))inlineCallees.push(expression)
  }
  ts.forEachChild(node,visitCalls)
}
visitCalls(publishedRegional.initializer)
assert.equal(inlineCallees.length,2)
const helperNames=new Map<any,string>(),inlinedHelperQualification:any[]=[]
for(const inline of inlineCallees){
  const text=inline.getText(publishedFile)
  const name=text.includes("fie(")?"getFixedRouteSlice":"fixedRouteSliceTouchesTargetLayer"
  assert(![...helperNames.values()].includes(name))
  const baseCanonical=await canonical(compileExpression(variable(helpers.beforeFile,name).initializer,helpers.beforeFile),true)
  const publishedCanonical=await canonical(text,true)
  const aliases=deriveAliases(baseCanonical,publishedCanonical,`inlined ${name}`)
  mergeAliases(helpers.aliases,aliases);helperNames.set(inline,name)
  inlinedHelperQualification.push({name,publishedInlineSha256:sha(text),baseCanonicalSha256:sha(baseCanonical),publishedCanonicalSha256:sha(publishedCanonical),aliases,compiledBaseEquivalent:true})
}
const transform=ts.transform(publishedRegional.initializer,[(context:any)=>{
  const visit=(node:any):any=>helperNames.has(node)?ts.factory.createIdentifier(helperNames.get(node)!):ts.visitEachChild(node,visit,context)
  return visit
}])
const normalizedRegional=ts.createPrinter().printNode(ts.EmitHint.Expression,transform.transformed[0],publishedFile)
transform.dispose()
const regularInlineCallees:any[]=[]
const findRegularInline=(node:any):void=>{
  if(ts.isCallExpression(node)){
    let expression=node.expression
    while(ts.isParenthesizedExpression(expression))expression=expression.expression
    if(ts.isArrowFunction(expression))regularInlineCallees.push(expression)
  }
  ts.forEachChild(node,findRegularInline)
}
const publishedRegular=variable(publishedFile,"rse")
findRegularInline(publishedRegular.initializer)
assert.equal(regularInlineCallees.length,1)
const boundaryHelper="areAllPortPointsOnNodeBoundary",boundaryInline=regularInlineCallees[0]
const boundaryBaseCanonical=await canonical(compileExpression(variable(helpers.beforeFile,boundaryHelper).initializer,helpers.beforeFile),true)
const boundaryPublishedCanonical=await canonical(boundaryInline.getText(publishedFile),true)
const boundaryAliases=deriveAliases(boundaryBaseCanonical,boundaryPublishedCanonical,`inlined ${boundaryHelper}`)
mergeAliases(helpers.aliases,boundaryAliases)
inlinedHelperQualification.push({name:boundaryHelper,publishedInlineSha256:sha(boundaryInline.getText(publishedFile)),baseCanonicalSha256:sha(boundaryBaseCanonical),publishedCanonicalSha256:sha(boundaryPublishedCanonical),aliases:boundaryAliases,compiledBaseEquivalent:true})
const regularTransform=ts.transform(publishedRegular.initializer,[(context:any)=>{
  const visit=(node:any):any=>node===boundaryInline?ts.factory.createIdentifier(boundaryHelper):ts.visitEachChild(node,visit,context)
  return visit
}])
const normalizedRegular=ts.createPrinter().printNode(ts.EmitHint.Expression,regularTransform.transformed[0],publishedFile)
regularTransform.dispose()
for(const record of records){
  for(const name of record.variables??[]){
    const baseNode=variable(record.beforeFile,name)
    let prelude=""
    if(name==="fixedRouteSlicesAreContiguous")prelude=transpiler.transformSync(`const ${variable(record.beforeFile,"pointsAreEqual").getText(record.beforeFile)};`)
    const baseCanonical=await canonical(compileExpression(baseNode.initializer,record.beforeFile),true,prelude)
    const publishedNode=variable(publishedFile,publishedNames[name])
    const publishedCanonical=await canonical(name==="createRegionalFallbackProblem"?normalizedRegional:name==="preparePipeline9RegularRegionalCandidate"?normalizedRegular:publishedNode.initializer.getText(publishedFile),true)
    const aliases=deriveAliases(baseCanonical,publishedCanonical,name)
    mergeAliases(record.aliases,aliases)
    record.aliases[name]=publishedNames[name]
    record.qualifications.push({name,baseCanonical,publishedCanonical,aliases})
  }
  if(record.className){
    record.baseClass=sourceClass(record.beforeFile,record.className)
    record.candidateClass=sourceClass(record.afterFile,record.className)
    record.publishedClass=publishedClass(record.publishedClassName,record.className)
    for(const name of record.methods){
      const baseCanonical=await canonical(compileMember(member(record.baseClass,name).getText(record.beforeFile)))
      const publishedCanonical=await canonical(member(record.publishedClass,name).getText(publishedFile))
      const aliases=deriveAliases(baseCanonical,publishedCanonical,`${record.className}.${name}`)
      mergeAliases(record.aliases,aliases)
      record.qualifications.push({name,baseCanonical,publishedCanonical,aliases})
    }
  }
}
mergeAliases(helpers.aliases,sharedAliases)
hd.aliases.BOUNDARY_COORDINATE_TOLERANCE_MM="Ia"
assert(!original.includes("getFixedRouteSlices"),"Inserted global must not collide")
sharedAliases.getFixedRouteSlices="getFixedRouteSlices"
for(const record of records)record.aliases.getFixedRouteSlices="getFixedRouteSlices"
const spans:any[]=[]
const addSpan=(record:any,name:string,oldNode:any,replacementText:string,qualification?:any):void=>{
  const startCharacter=oldNode.getStart(publishedFile),endCharacter=qualification?oldNode.end:startCharacter
  const originalText=original.slice(startCharacter,endCharacter)
  spans.push({kind:qualification?"replace":"insert",name,sourceRepository:repository.repository,sourceRelative:record.relative,
    startCharacter,endCharacter,startByte:Buffer.byteLength(original.slice(0,startCharacter)),endByte:Buffer.byteLength(original.slice(0,endCharacter)),
    originalText,replacementText,originalSha256:sha(originalText),replacementSha256:sha(replacementText),compiledBaseEquivalent:qualification?true:null,
    ...(qualification?{baseCanonicalSha256:sha(qualification.publishedCanonical),aliases:qualification.aliases}:{})})
}
const newHelperNode=variable(helpers.afterFile,"getFixedRouteSlices")
const newHelperCode=parse(transpiler.transformSync(`const ${renameNode(helpers,newHelperNode,helpers.aliases)};`))
addSpan(helpers,"getFixedRouteSlices",variable(publishedFile,"vie"),`${variable(newHelperCode,"getFixedRouteSlices").getText(newHelperCode)},`)
for(const record of records){
  for(const name of record.variables??[]){
    const candidateNode=variable(record.afterFile,name)
    const emitted=parse(transpiler.transformSync(`const ${renameNode(record,candidateNode,record.aliases)};`))
    let replacement=variable(emitted,publishedNames[name]).getText(emitted)
    const dependencies=name==="fixedRouteSlicesAreContiguous"?["pointsAreEqual"]:name==="createRegionalFallbackProblem"?["fixedRouteSliceTouchesTargetLayer"]:name==="preparePipeline9RegularRegionalCandidate"?[boundaryHelper]:[]
    if(dependencies.length){
      const dependencyRecord=name==="preparePipeline9RegularRegionalCandidate"?helpers:record
      const dependencyNodes=new Map<string,string>()
      for(const helper of dependencies){
        const dependencyFile=parse(transpiler.transformSync(`const ${renameNode(dependencyRecord,variable(dependencyRecord.afterFile,helper),dependencyRecord.aliases)};`))
        dependencyNodes.set(helper,variable(dependencyFile,helper).initializer.getText(dependencyFile))
      }
      const substitutions=new Map(dependencies.map(helper=>[helper,0]))
      const expressionNode=variable(emitted,publishedNames[name]).initializer,edits:any[]=[]
      const visit=(node:any):void=>{
          if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&dependencyNodes.has(node.expression.text)){
            const helper=node.expression.text;substitutions.set(helper,substitutions.get(helper)!+1)
            edits.push({start:node.expression.getStart(emitted)-expressionNode.getStart(emitted),end:node.expression.end-expressionNode.getStart(emitted),replacement:`(${dependencyNodes.get(helper)})`})
          }
          ts.forEachChild(node,visit)
      }
      visit(expressionNode)
      for(const count of substitutions.values())assert(count>0)
      let expression=expressionNode.getText(emitted)
      for(const edit of edits.sort((a,b)=>b.start-a.start))expression=expression.slice(0,edit.start)+edit.replacement+expression.slice(edit.end)
      const clustered=parse(await canonical(expression,true))
      assert.equal(clustered.statements.length,1,"Source-local dependencies must inline")
      replacement=`${publishedNames[name]}=${variable(clustered,"Qualified").initializer.getText(clustered)}`
    }
    addSpan(record,name,variable(publishedFile,publishedNames[name]),replacement,record.qualifications.find((q:any)=>q.name===name))
  }
  for(const name of record.methods??[]){
    const replacement=compileMember(renameNode(record,member(record.candidateClass,name),record.aliases))
    addSpan(record,`${record.className}.${name}`,member(record.publishedClass,name),replacement,record.qualifications.find((q:any)=>q.name===name))
  }
}
spans.sort((a,b)=>a.startCharacter-b.startCharacter||(a.kind==="insert"?-1:1))
assert.equal(spans.filter(s=>s.kind==="replace").length,4)
assert.equal(spans.filter(s=>s.kind==="insert").length,1)
let cursor=0,candidate=""
const unchangedSegments:any[]=[]
for(const item of spans){
  assert(item.startCharacter>=cursor)
  const unchanged=original.slice(cursor,item.startCharacter)
  if(unchanged.length)unchangedSegments.push({startByte:Buffer.byteLength(original.slice(0,cursor)),endByte:item.startByte,candidateStartByte:Buffer.byteLength(candidate),candidateEndByte:Buffer.byteLength(candidate+unchanged),sha256:sha(unchanged)})
  candidate+=unchanged+item.replacementText;cursor=item.endCharacter
}
const tail=original.slice(cursor)
if(tail.length)unchangedSegments.push({startByte:Buffer.byteLength(original.slice(0,cursor)),endByte:Buffer.byteLength(original),candidateStartByte:Buffer.byteLength(candidate),candidateEndByte:Buffer.byteLength(candidate+tail),sha256:sha(tail)})
candidate+=tail;parse(candidate)
for(const segment of unchangedSegments)assert.equal(sha(Buffer.from(candidate).subarray(segment.candidateStartByte,segment.candidateEndByte)),segment.sha256)
const productionPatch=git(arRoot,["diff","--binary",baseCommit,"--",...repository.changedFiles.map((row:any)=>row.relative)])
const candidateCommit=git(arRoot,["status","--porcelain","--",...repository.changedFiles.map((row:any)=>row.relative)]).trim()?null:git(arRoot,["rev-parse","HEAD"]).trim()
assert.equal(candidateCommit,handoff.repositories[0].candidateCommit)
assert.equal(sha(productionPatch),handoff.repositories[0].patches.production.sha256)
assert(allowDraft||candidateCommit)
writeFileSync(join(outDir,repository.productionPatchFile),productionPatch)
mkdirSync(join(outDir,"dist"),{recursive:true})
const source={repositories:[{...repository,candidateCommit,productionPatchSha256:sha(productionPatch)}]}
const mapping={schemaVersion:2,passed:true,sourceFrozen:!allowDraft,originalAutorouterSha256:sha(original),candidateAutorouterSha256:sha(candidate),sourceMapSha256:sha(sourceMapText),source,
  spans,unchangedSegments,qualification:{allOutsideBytesUnchanged:true,unrelatedSourceRuntimeUnchanged:true,compiledBaseEquivalent:true,sourceMapGeneratedOffsetsUsed:false,
    typeErasure:"TypeScript5.9.3 transpileModule targeting ESNext; no Bun syntax optimization",
    canonicalizer:"Terser5.51.2 three compression passes and deterministic lexical names; differing free bindings mapped bijectively; properties and local bindings must match exactly",
    sourceAliases:records.map(record=>({relative:record.relative,aliases:record.aliases})),inlinedHelperEquivalence:inlinedHelperQualification,unchangedHelperQualification,
    existingBoundaryTolerance:{name:"BOUNDARY_COORDINATE_TOLERANCE_MM",publishedName:"Ia",value:1e-6,sourceIndex:201},bun:Bun.version,typescript:ts.version,terser:require("terser/package.json").version},
  sourceHandoffSha256:sha(handoffText),mapperSha256:sha(readFileSync(import.meta.path)),moduleImported:false,nativeRoutingExecuted:false}
writeFileSync(join(outDir,"dist/local-preload-retention-candidate.js"),candidate)
writeFileSync(join(outDir,"local-preload-retention-source-mapping.json"),JSON.stringify(mapping,null,2)+"\n")
console.log(JSON.stringify({passed:true,replacements:4,insertions:1,candidateAutorouterSha256:mapping.candidateAutorouterSha256,source,nativeRoutingExecuted:false}))

