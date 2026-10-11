import {createHash} from "node:crypto"
import {cp,mkdir,symlink} from "node:fs/promises"
import {resolve} from "node:path"
import {deepStrictEqual} from "node:assert"

const source=process.env.GENERIC_HD_CENSUS_ROOT,jobPath=process.env.GENERIC_HD_CENSUS_JOB
const referencePath=process.env.GENERIC_HD_CENSUS_REFERENCE
if(!source||!jobPath||!referencePath) throw new Error("Frozen source, captured ordinary job and unmodified result are required")
const directory=resolve(process.env.GENERIC_HD_CENSUS_OUTPUT??"/tmp/native-generic-hd-work-census")
const copied=`${directory}/source`
await mkdir(copied,{recursive:true})
await cp(`${source}/lib`,`${copied}/lib`,{recursive:true})
await cp(`${source}/types`,`${copied}/types`,{recursive:true})
await cp(`${source}/tsconfig.json`,`${copied}/tsconfig.json`)
await cp(`${source}/package.json`,`${copied}/package.json`)
await symlink(`${source}/node_modules`,`${copied}/node_modules`)
await cp(new URL("./native-generic-hd-work-census/counters.ts",import.meta.url),`${copied}/lib/genericHdWorkCounters.ts`)
const patches:Record<string,[string,string][]>={
  "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts":[
    ['      this.closestFuturePointCacheIndices.fill(-2)','      record(this,"closestInvalidations")\n      this.closestFuturePointCacheIndices.fill(-2)'],
    ['    // Rounded grid keys can alias coordinates or layers outside the grid.','    closestRequest(this,node,pointKey,viaPenaltyDistance)\n    // Rounded grid keys can alias coordinates or layers outside the grid.'],
    ['      return cachedPointIndex === -1','      record(this,"closestHits")\n      return cachedPointIndex === -1'],
    ['    let minDist = Infinity','    closestMiss(this)\n    let minDist = Infinity'],
    ['    // A fixed workspace avoids retaining every explored coordinate in large','    record(this,"closestPointScans",pointIndex)\n    // A fixed workspace avoids retaining every explored coordinate in large'],
    ['  override setNodeCosts(node: Node) {','  override setNodeCosts(node: Node) {\n    record(this,"nativeCostCalls")'],
  ],
  "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver.ts":[
    ['  get viaPenaltyDistance() {','  get viaPenaltyDistance() {\n    record(this,"viaDistanceGetterCalls")'],
    ['    margin ??= this.obstacleMargin','    record(this,isVia?"viaObstacleCalls":"planarObstacleCalls")\n    margin ??= this.obstacleMargin'],
    ['        return false\n      }\n    }\n    const indexedSegments =','        record(this,"planarFreeCacheHits")\n        return false\n      }\n    }\n    const indexedSegments ='],
    ['    const queryBounds = planarObstacleQuery?.segmentBounds\n    if (indexedSegments)', '    record(this,"segmentCandidates",nearbySegmentIds.length)\n    const queryBounds = planarObstacleQuery?.segmentBounds\n    if (indexedSegments)'],
    ['        const segment = indexedSegments[segmentId]','        record(this,"segmentVisits")\n        const segment = indexedSegments[segmentId]'],
    ['        if (\n          Math.sqrt(\n            getPointToPrecomputedSegmentDistanceSquared(','        record(this,"segmentDistanceChecks")\n        if (\n          Math.sqrt(\n            getPointToPrecomputedSegmentDistanceSquared('],
    ['      for (const viaId of nearbyViaIds) {','      record(this,"viaCandidates",nearbyViaIds.length)\n      for (const viaId of nearbyViaIds) {'],
    ['  getNodeKey(node: Node) {','  getNodeKey(node: Node) {\n    record(this,"nodeKeyCalls")'],
  ],
  "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/HighDensityRouteCostMemo.ts":[
    ['  private calculateCosts(node: Node, knownPointKey?: number): void {','  private calculateCosts(node: Node, knownPointKey?: number): void {\n    record(this.solver,"memoCostCalls")'],
    ['    if (valid & GOAL_VALID) {','    if (valid & GOAL_VALID) {\n      record(solver,"memoGoalHits")'],
    ['    if (valid & penaltyValidity) {','    if (valid & penaltyValidity) {\n      record(solver,"memoPenaltyHits")'],
  ],
}
const sourceHashes:Record<string,string>={}
const squaredGroupProbe=process.env.GENERIC_HD_CENSUS_SQUARED_GROUP_PROBE==="1"
const squaredGroupScanner=process.env.GENERIC_HD_CENSUS_SQUARED_GROUP_SCANNER==="1"
const captureGenericCandidates=process.env.GENERIC_HD_CENSUS_CAPTURE_CANDIDATES==="1"
if(squaredGroupProbe&&squaredGroupScanner) throw new Error("Hypothetical probe and actual isolated scanner must use separate runs")
if(squaredGroupScanner) {
  const prefix="lib/autorouter-pipelines/AutoroutingPipeline9_Parallel"
  const scannerPath=`${prefix}/generic-hd-closest-point/scanClosestFuturePointMiss.ts`
  let scanner=await Bun.file(new URL(`../../../${scannerPath}`,import.meta.url)).text()
  sourceHashes[scannerPath]=createHash("sha256").update(scanner).digest("hex")
  scanner=scanner.replace('      pointIndex++\n      continue','      record(owner,"actualIsolatedSkippedIntrinsicSqrt")\n      pointIndex++\n      continue')
    .replace('    if (pureNumericSqrt) baseDistance = nativeApply(callee, Math, [square])',
      '    if (pureNumericSqrt) {record(owner,"actualIsolatedRequiredIntrinsicSqrt");baseDistance = nativeApply(callee, Math, [square])}')
  await mkdir(`${copied}/${prefix}/generic-hd-closest-point`,{recursive:true})
  await Bun.write(`${copied}/${scannerPath}`,'import {record} from "lib/genericHdWorkCounters"\n'+scanner)
  // This copied-source oracle grants no production task/owner authority.
  await Bun.write(`${copied}/${prefix}/NativeGenericHistoryTaskAuthority.ts`,
    'export const isolatedScannerContext={sqrt:Math.sqrt,apply:Reflect.apply}\nexport function hasNativeGenericIntrinsicContext(value:unknown):boolean{return value===isolatedScannerContext}\n')
  const routePath="lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts"
  const original=await Bun.file(`${source}/${routePath}`).text()
  const begin=original.indexOf('    let minDist = Infinity')
  const end=original.indexOf('    // A fixed workspace avoids retaining every explored coordinate in large')
  if(begin<0||end<begin) throw new Error("Isolated scanner could not identify the pinned native miss block")
  patches[routePath]!.push([original.slice(begin,end),
    '    const miss=scanClosestFuturePointMiss(this,node,isolatedScannerContext)\n    const closestPoint=miss.point,closestPointIndex=miss.index\n    const pointIndex=this.futureConnectionPoints.length\n\n'])
}
if(captureGenericCandidates) {
  patches["lib/solvers/HighDensitySolver/IntraNodeSolver.ts"]=[
    ['    super()\n    this.nodeWithPortPoints = nodeWithPortPoints','    super()\n    captureGenericConstructor(this,params)\n    this.nodeWithPortPoints = nodeWithPortPoints'],
  ]
  patches["lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver.ts"]=[
    ['    const wasSolved = this.solved','    captureGenericPostCacheMiss(this)\n    const wasSolved = this.solved'],
  ]
}
if(squaredGroupProbe) {
  const routeFile="lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts"
  patches[routeFile]!.push(
    ['    let pointIndex = 0\n\n    for (const point', '    let pointIndex = 0\n    let planarGroupSquare=Infinity, viaGroupSquare=Infinity\n    let planarGroupValid=false, viaGroupValid=false\n\n    for (const point'],
    ['      if (dist < minDist) {', `      // This diagnostic still executes every original sqrt and getter.
      // Additional data-only point reads count hypothetical group pruning.
      const probeDx=node.x-point.x, probeDy=node.y-point.y
      const probeSquare=probeDx*probeDx+probeDy*probeDy
      const probeVia=node.z!==point.z
      const previousSquare=probeVia?viaGroupSquare:planarGroupSquare
      const previousValid=probeVia?viaGroupValid:planarGroupValid
      if(probeSquare===probeSquare && dist===dist) {
        if(previousValid && probeSquare>=previousSquare) record(this,"hypotheticalSkippedIntrinsicSqrt")
        else record(this,"hypotheticalRequiredIntrinsicSqrt")
        if(!previousValid || probeSquare<previousSquare) {
          if(probeVia) {viaGroupSquare=probeSquare;viaGroupValid=true}
          else {planarGroupSquare=probeSquare;planarGroupValid=true}
        }
      } else record(this,"hypotheticalUnsupportedSqrt")
      if (dist < minDist) {`],
  )
}
for(const [path,replacements] of Object.entries(patches)) {
  const original=await Bun.file(`${source}/${path}`).text()
  sourceHashes[path]=createHash("sha256").update(original).digest("hex")
  let text=original
  for(const [before,after] of replacements) {
    if(text.indexOf(before)<0||text.indexOf(before)!==text.lastIndexOf(before)) throw new Error(`Census insertion is not unique: ${path}: ${before}`)
    text=text.replace(before,after)
  }
  const scannerImport=squaredGroupScanner&&path.endsWith("SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.ts")
    ? 'import {scanClosestFuturePointMiss} from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/generic-hd-closest-point/scanClosestFuturePointMiss"\nimport {isolatedScannerContext} from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeGenericHistoryTaskAuthority"\n' : ""
  await Bun.write(`${copied}/${path}`,scannerImport+'import {record,closestRequest,closestMiss,captureGenericConstructor,captureGenericPostCacheMiss} from "lib/genericHdWorkCounters"\n'+text)
}
const raw=new Uint8Array(await Bun.file(jobPath).arrayBuffer()),bytes=jobPath.endsWith(".gz")?Bun.gunzipSync(raw):raw
const job=JSON.parse(new TextDecoder().decode(bytes))
const workerSource=await Bun.file(new URL("./native-generic-hd-work-census/worker.ts",import.meta.url)).text()
async function runWorker(root:string,name:string,instrumented:boolean):Promise<{response:unknown;census:unknown}> {
  let entry=workerSource.replace('process.env.GENERIC_HD_CENSUS_COPY',JSON.stringify(root))
  if(!instrumented) entry=entry.replace('const counters=await import(`${sourceRoot}/lib/genericHdWorkCounters.ts`)','const counters={snapshot:():null=>null}')
  await Bun.write(`${directory}/${name}.ts`,entry)
  const worker=new Worker(`${directory}/${name}.ts`)
  return await new Promise<{response:unknown;census:unknown}>((resolveResult,reject):void=>{
    worker.onerror=(event:ErrorEvent):void=>reject(new Error(event.message))
    worker.onmessage=(event:MessageEvent):void=>{
      const message=event.data
      if(message.error) {reject(new Error(message.error));return}
      if(message.kind==="requestMultiHeadHistories"||message.kind==="requestGridHistories"||message.kind==="requestFirstValidA13Candidate") {
        const kind=message.kind==="requestMultiHeadHistories"?"multiHeadHistoryGrant":message.kind==="requestGridHistories"?"gridHistoryGrant":"firstValidA13CandidateGrant"
        worker.postMessage({kind,taskId:message.taskId,requestId:message.requestId,admittedCandidateIds:[],admitted:false})
        return
      }
      if(typeof message.kind==="string"&&message.kind.startsWith("cancel")) return
      resolveResult(message)
    }
    worker.postMessage({taskId:1,idleWorkerAvailability:new SharedArrayBuffer(4),job})
  }).finally(():void=>worker.terminate())
}
const result=await runWorker(copied,"worker",true)
const native=await runWorker(source,"reference-worker",false)
deepStrictEqual(result.response,native.response,"Instrumentation must preserve the complete actual native worker result")
deepStrictEqual(JSON.parse(JSON.stringify(native.response)),await Bun.file(referencePath).json(),"Fresh original worker must also match the saved frozen profile result")
const proof={noTimingComparison:true,actualWorker:true,nativeMethodWrappers:false,fullOriginalResultEqual:true,
  squaredGroupProbe,squaredGroupScanner,captureGenericCandidates,
  isolatedScannerUsesTestOnlyAuthority:squaredGroupScanner,productionActivation:false,
  hypotheticalProbeRetainsEveryOriginalSqrtAndGetter:squaredGroupProbe,
  jobSha256:createHash("sha256").update(bytes).digest("hex"),frozenSourceRoot:source,sourceHashes,census:result.census}
await Bun.write(`${directory}/proof.json`,JSON.stringify(proof,null,2))
console.log(JSON.stringify(proof,null,2))
