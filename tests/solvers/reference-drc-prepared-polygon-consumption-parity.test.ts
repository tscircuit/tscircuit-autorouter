import { expect, test } from "bun:test"
import { Box, Polygon } from "@flatten-js/core"
import Flatbush from "flatbush"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { captureReferenceDrcPolygonSnapshot, captureReferenceDrcPolygonSnapshotsWithinDomain } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/referenceDrcPolygonFacts"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { executeParallelReferenceContinuityBatch, prepareParallelReferenceContinuityContext } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityTypes"
import { checkViaTraceClearanceWithLazyCenters } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"
import { captureNativeSourceAliasProvenance } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSourceAliasProvenance"

test("prepared scaled polygon misses retain original Native graph, memo, constructor and exception boundaries", async () => {
  await initializeReferenceDrcRuntime()
  const repo = resolve(import.meta.dir, "../.."), work = mkdtempSync(join(tmpdir(), "reference-prepared-polygons-"))
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
  const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork")
  const sources = { scope: join(base, "referenceDrcNativeInternScope.ts"), checker: join(base,"native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"), index: join(base,"native/lib/util/create-indexed-pcb-connectivity-map.ts"), via: join(base,"native/lib/util/get-via-and-pour-connections.ts"), planner: join(base,"referenceDrcPrimitiveMissPlanning.ts"), trace: join(base,"prepareReferenceDrcTracePairFacts.ts"), polygon: join(base,"prepareReferenceDrcPolygonFacts.ts") }
  const copies = Object.fromEntries(Object.keys(sources).map((key) => [key,join(work,`${key}.ts`)])) as Record<keyof typeof sources,string>
  for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
    let source = readFileSync(sources[kind],"utf8")
    if (kind === "checker") source = "export let latestPrivateMemo: any\nexport function getPolygonMemo(memo: any): any { return privatelyOwnedPolygonMemos.get(memo) }\n" + source.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  latestPrivateMemo = primitiveMemo")
    if (kind === "index") source = "export let latestPhysicalMap: any\n" + source.replace("  return map\n", "  latestPhysicalMap = map\n  return map\n")
    // Fixed pure oracle only. Production retains the minted Native transport
    // brand/capacity requirements and full existing private checker guard.
    if (kind === "trace" || kind === "polygon") {
      expect(source.includes("!isNativeSyncReferenceFactExecutor(executor)")).toBe(true)
      expect(source.includes("!canAdmitNativeSyncReferenceFacts(executor)")).toBe(true)
      source = source.replace("!isNativeSyncReferenceFactExecutor(executor)","false").replace("!canAdmitNativeSyncReferenceFacts(executor)","false")
    }
    source = source.replace(/from\s+"(\.[^"]+)"/g, (_match,spec:string):string => {
      let target = resolve(dirname(sources[kind]),spec)
      if (spec.includes("check-traces-are-contiguous/check-traces-are-contiguous")) target=copies.checker
      else if (spec.endsWith("create-indexed-pcb-connectivity-map")) target=copies.index
      else if (spec.endsWith("get-via-and-pour-connections")) target=copies.via
      else if (spec.endsWith("referenceDrcPrimitiveMissPlanning")) target=copies.planner
      else if (spec.endsWith("referenceDrcNativeInternScope")) target=copies.scope
      else if (spec.endsWith("prepareReferenceDrcTracePairFacts")) target=copies.trace
      else if (spec.endsWith("prepareReferenceDrcPolygonFacts")) target=copies.polygon
      return `from ${JSON.stringify(target)}`
    })
    writeFileSync(copies[kind],source)
  }
  const checker = await import(copies.checker), indexModule = await import(copies.index), prepareModule = await import(copies.polygon)
  const memoState = (memo:ReferenceDrcPrimitiveMemo):unknown => ({ diagnostics:{...memo.diagnostics}, values:[...(memo as any).values], identities:[...(memo as any).identities], nextIdentity:(memo as any).nextIdentity })
  const polygonState = (memo:any):unknown => memo === undefined ? undefined : ({ diagnostics:{...memo.diagnostics}, retainedEdges:memo.retainedEdges, rows:[...memo.rows].map(([id,row]:[number,any]) => [id,{edges:row.edges,polygon:row.polygon===undefined?undefined:captureReferenceDrcPolygonSnapshot(row.polygon)}]) })
  const native = checker.createPrivatelyMemoizedTraceContinuityChecker(), nativeMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  let traceRows=0, polygonRows=0, polygonBatches=0, scheduledPolygons=0, scheduledEdges=0
  const prepared = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch:ParallelReferenceContinuityBatch) => {
    if (batch.context.geometryPolygons !== undefined) {
      polygonBatches++; polygonRows+=batch.tasks.length; scheduledPolygons+=batch.context.geometryPolygons.length
      for (const snapshot of batch.context.geometryPolygons) for (const face of snapshot.faces) scheduledEdges+=face.length
      expect(batch.context.geometryTraces).toBeUndefined()
    }
    else traceRows+=batch.tasks.length
    return executeParallelReferenceContinuityBatch(batch)
  })
  const preparedMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  const captures = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz",import.meta.url)))).toString()) as {records:any[]}
  const rowsPerRecord:number[]=[]
  for (const capture of captures.records) {
    const nativeInput=structuredClone(capture.circuitJson), preparedInput=structuredClone(capture.circuitJson)
    const options={...capture.options,viaTraceChecker:(circuit:any,viaOptions:any):ReturnType<typeof checkViaTraceClearanceWithLazyCenters> => checkViaTraceClearanceWithLazyCenters(circuit,{...viaOptions,enableAxisRejection:true,enableConnectivityMemo:true})}
    const nativeOutput=getDrcErrors(nativeInput,{...options,traceContinuityChecker:native}), nativeMap=indexModule.latestPhysicalMap
    const before=polygonRows
    const preparedOutput=getDrcErrors(preparedInput,{...options,traceContinuityChecker:prepared}), preparedMap=indexModule.latestPhysicalMap
    expect(JSON.parse(JSON.stringify(nativeOutput))).toEqual(capture.expected)
    expect(preparedOutput).toEqual(nativeOutput); expect(preparedInput).toEqual(nativeInput)
    expect(captureNativeSourceAliasProvenance(preparedOutput,preparedInput)).toEqual(captureNativeSourceAliasProvenance(nativeOutput,nativeInput))
    expect(memoState(preparedMemo)).toEqual(memoState(nativeMemo))
    expect(polygonState(checker.getPolygonMemo(preparedMemo))).toEqual(polygonState(checker.getPolygonMemo(nativeMemo)))
    if (nativeInput.some((element:any) => element.type==="pcb_trace")) {
      expect(preparedMap.connMap).toEqual(nativeMap.connMap)
      expect(preparedMap.circuitJson).toBe(preparedInput); expect(nativeMap.circuitJson).toBe(nativeInput)
      for (const [id,trace] of preparedMap.traceIdToElm) expect(trace).toBe(preparedInput.find((element:any) => element.type==="pcb_trace"&&element.pcb_trace_id===id))
    }
    rowsPerRecord.push(polygonRows-before)
  }
  expect(polygonBatches).toBe(13); expect(polygonRows).toBe(15901); expect(traceRows).toBe(12215)
  expect(rowsPerRecord).toEqual([0,2671,1635,2130,832,2173,881,340,1642,579,0,1342,40,0,400,0,1236])
  const simple=():any[] => [{type:"pcb_via",pcb_via_id:"via",x:0,y:0,outer_diameter:0.6,hole_diameter:0.2,layers:["top","bottom"]},{type:"pcb_trace",pcb_trace_id:"trace",route:[{route_type:"wire",x:-1,y:0,width:0.1,layer:"top"},{route_type:"wire",x:1,y:0,width:0.1,layer:"top"}]}]
  let unavailableCalls=0
  const unavailable=checker.createPreparedPrivatelyMemoizedTraceContinuityChecker(() => {unavailableCalls++;return undefined}), unavailableMemo=checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  const ordinary=checker.createPrivatelyMemoizedTraceContinuityChecker(), ordinaryMemo=checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  expect(unavailable(simple())).toEqual(ordinary(simple())); expect(memoState(unavailableMemo)).toEqual(memoState(ordinaryMemo)); expect(unavailableCalls).toBe(1)
  expect(unavailable(simple())).toEqual(ordinary(simple())); expect(memoState(unavailableMemo)).toEqual(memoState(ordinaryMemo)); expect(unavailableCalls).toBe(1)
  for (const field of ["x","outer_diameter","width"] as const) {
    const hidden=():any[] => {const circuit=simple(),target=field==="width"?circuit[1].route[0]:circuit[0];Object.defineProperty(target,field,{...Object.getOwnPropertyDescriptor(target,field)!,enumerable:false});return circuit}
    const hiddenNative=checker.createPrivatelyMemoizedTraceContinuityChecker(), hiddenNativeMemo=checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
    let calls=0
    const hiddenPrepared=checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch:ParallelReferenceContinuityBatch) => {calls++;return executeParallelReferenceContinuityBatch(batch)}), hiddenMemo=checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
    expect(hiddenPrepared(hidden())).toEqual(hiddenNative(hidden())); expect(memoState(hiddenMemo)).toEqual(memoState(hiddenNativeMemo)); expect(calls).toBe(1)
  }
  let getterCalls=0
  const malformed=checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch:ParallelReferenceContinuityBatch) => {
    const result=executeParallelReferenceContinuityBatch(batch)
    Object.defineProperty(result.facts[result.facts.length-1]!,"value",{get():never {getterCalls++;throw new Error("unused getter")}})
    return result
  }), malformedMemo=checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  expect(() => malformed(simple())).toThrow("own data reference field value"); expect(getterCalls).toBe(0); expect(malformedMemo.diagnostics).toEqual({hits:0,misses:0})
  const falseException=checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch:ParallelReferenceContinuityBatch) => ({kind:"referenceContinuityFacts",snapshotId:batch.context.snapshotId,facts:batch.tasks.map((task) => ({status:"exception",kind:"native-polygon-contact-miss",rowIndex:task.rowIndex,consumedVisits:1,exception:{name:"RangeError",message:"worker-only"}}))}))
  expect(() => falseException(simple())).toThrow("polygon exception did not reproduce"); expect(checker.latestPrivateMemo.diagnostics).toEqual({hits:0,misses:1})
  checker.createPrivatelyMemoizedTraceContinuityChecker()
  const reconsumedMemo=checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  const poly=new Polygon(new Box(-1,-1,1,1)), conductors=[{id:"a",layers:["top"],polygon:poly,bridges:true,geometryId:reconsumedMemo.intern("a")},{id:"b",layers:["top"],polygon:poly,bridges:false,geometryId:reconsumedMemo.intern("b")}]
  const bounds=new Flatbush(2);bounds.add(-1,-1,1,1);bounds.add(-1,-1,1,1);bounds.finish()
  let sharedPolygonCount=0
  const reconsumed=prepareModule.prepareReferenceDrcPolygonFacts(reconsumedMemo,conductors,bounds,0.1,(batch:ParallelReferenceContinuityBatch) => {
    sharedPolygonCount=batch.context.geometryPolygons!.length
    return {kind:"referenceContinuityFacts",snapshotId:batch.context.snapshotId,facts:batch.tasks.map((task) => ({status:"exception",kind:"native-polygon-contact-miss",rowIndex:task.rowIndex,consumedVisits:1,exception:{name:"RangeError",message:"worker-only"}}))}
  })!
  const sentinel=new RangeError("original main polygon predicate"), beforeState=memoState(reconsumedMemo)
  let thrown:unknown, nativeCalls=0
  try {reconsumed.consume(0,1,():never => {nativeCalls++;throw sentinel})} catch(error:unknown) {thrown=error}
  expect(thrown).toBe(sentinel);expect(nativeCalls).toBe(1);expect(sharedPolygonCount).toBe(1);expect(reconsumedMemo.diagnostics).toEqual({hits:0,misses:1});expect([...(reconsumedMemo as any).values]).toEqual([]);expect(beforeState).not.toEqual(memoState(reconsumedMemo))
  const malformedContext=prepareParallelReferenceContinuityContext({snapshotId:7,portCount:0,tracePortOrdinals:[],components:[],geometryPolygons:[{faces:[[],captureReferenceDrcPolygonSnapshot(poly).faces[0]!]}],geometryTolerance:0.1})
  expect(() => executeParallelReferenceContinuityBatch({kind:"referenceContinuityFacts",context:malformedContext,tasks:[{kind:"native-polygon-contact-miss",rowIndex:0,leftPolygonIndex:0,rightPolygonIndex:0}]})).toThrow("Illegal Parameters")
  const overflow=new Polygon(new Box(-1,-1,1,1)); for(const edge of overflow.edges) (edge.shape as any).ps.x=Infinity
  expect(captureReferenceDrcPolygonSnapshotsWithinDomain([overflow])).toBeUndefined()
  expect(captureReferenceDrcPolygonSnapshotsWithinDomain(new Array(90_000).fill(poly))).toBeUndefined()
  let observerExecutions=0
  const observedChecker=checker.createPreparedPrivatelyMemoizedTraceContinuityChecker(() => {observerExecutions++;throw new Error("observer fact execution")})
  const observed=(counts:{reads:number}):any[] => {const circuit=simple();Object.defineProperty(circuit[0],"x",{enumerable:true,configurable:true,get():number {counts.reads++;return 0}});return circuit}
  const nativeCounts={reads:0},preparedCounts={reads:0}
  expect(observedChecker(observed(preparedCounts))).toEqual(checker.createPrivatelyMemoizedTraceContinuityChecker()(observed(nativeCounts)));expect(preparedCounts.reads).toBe(nativeCounts.reads);expect(observerExecutions).toBe(0)
  const productionChecker=await import(sources.checker)
  expect(productionChecker.createPreparedPrivatelyMemoizedTraceContinuityChecker(() => {observerExecutions++;throw new Error("unbranded")})(simple())).toEqual(productionChecker.createPrivatelyMemoizedTraceContinuityChecker()(simple()));expect(observerExecutions).toBe(0)
  writeFileSync(join(work,"proof-result.json"),JSON.stringify({all17ErrorsExact:true,all17MemoValuesIdsFifoCountersExact:true,all17ScaledPolygonMemoStateExact:true,all17PhysicalGraphAndInputAliasesExact:true,traceRows,polygonRows,polygonBatches,scheduledPolygons,scheduledEdges,rowsPerRecord},null,2)+"\n")
})
