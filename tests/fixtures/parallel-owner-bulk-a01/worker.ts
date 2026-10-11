import { deepStrictEqual, strictEqual } from "node:assert"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { initializeWorkerNativeGridRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridRuntime"
import { beginWorkerNativeGridKernelQuantum,captureWorkerNativeGridPortfolioContract,
  finishWorkerNativeGridKernelQuantum,isWorkerNativeGridKernelQuantumActive,
  registerWorkerNativeGridKernelDispatcher,registerWorkerNativeGridOwner } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridKernelQuantum"
import { runWorkerNativeA01BulkSearchPrototype,getWorkerNativeA01BulkSearchPrototypeDiagnostics } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-bulk-search/workerNativeA01BulkSearchPrototype"
import { NativeA01BulkSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-bulk-search/NativeA01BulkSearchKernel"
import type { GridHistoryDispatcher,GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../parallel-grid-history-cmn45.json"

function nativeFields(solver:HighDensitySolverA01,names:readonly string[]):object {
  const fields:Record<string,unknown>={},descriptors=Object.getOwnPropertyDescriptors(solver)
  for(let index=0;index<names.length;index++) {
    fields[names[index]!]=descriptors[names[index]!]!.value
  }
  return fields
}

async function runOracle():Promise<object> {
  await initializeWorkerNativeGridRuntime()
  const dispatcher:GridHistoryDispatcher=async():Promise<Map<number,Promise<GridHistoryResult>>>=>new Map()
  registerWorkerNativeGridKernelDispatcher(dispatcher)
  const portfolio=new ParallelPortfolioSingleIntraNodeSolver({nodeWithPortPoints:structuredClone(cmn45) as NodeWithPortPoints,
    viaDiameter:.3,traceWidth:.1},async():Promise<Map<number,Promise<MultiHeadHistoryResult>>>=>new Map(),
    {policy:"ordered",gridHistoryDispatcher:dispatcher})
  const contract=captureWorkerNativeGridPortfolioContract(ParallelPortfolioSingleIntraNodeSolver.prototype)
  let checkpoints=0,frontiers=0,steps=0,bulkSteps=0,batches=0,heapPops=0,heapPushes=0,lateObservers=0
  const declineCases=["computeH-before","computeH-after","getRipCost","_step","heap-getter","counter-readonly","heap-row-readonly","node-getter","counter-getter"]
  for(const kind of declineCases) {
    const params={nodeWithPortPoints:structuredClone(cmn45) as NodeWithPortPoints,cellSizeMm:.1,
      viaDiameter:.3,traceThickness:.1,viaMinDistFromBorder:.15,traceMargin:.1,effort:1}
    const owner=new ReplayHighDensityA01Solver(params)
    registerWorkerNativeGridOwner(owner,dispatcher);owner.setup();owner.step()
    const before=owner.iterations,sentinel=new Error("native bulk admission observer"),host=owner as unknown as Record<string,unknown>
    const heap=Object.getOwnPropertyDescriptor(owner,"heap")!.value,nativePrototype=HighDensitySolverA01.prototype
    let target:object=owner,name="_step",method=false,calls=0
    if(kind.startsWith("computeH")) {target=nativePrototype;name="computeH"}
    if(kind==="getRipCost") {target=nativePrototype;name="getRipCost";method=true;(host.usedCellsFlat as Int32Array).fill(((host.activeConnId as number)+1)%(host.connIdToRootNet as string[]).length)}
    if(kind==="heap-getter") name="heap"
    if(kind==="counter-readonly"||kind==="counter-getter") name="iterations"
    if(kind==="heap-row-readonly") {target=heap.f;name="0"}
    if(kind==="node-getter") {target=(host.nodePool as object[])[0]!;name="g"}
    const original=Object.getOwnPropertyDescriptor(target,name)
    const mutate=():void=>{
      if(kind.endsWith("readonly")) Object.defineProperty(target,name,{...original,writable:false})
      else if(method) Object.defineProperty(target,name,{...original,value():never{calls++;throw sentinel}})
      else Object.defineProperty(target,name,{configurable:true,enumerable:original?.enumerable??false,get():never{calls++;throw sentinel}})
    }
    if(kind.endsWith("before")) mutate()
    const quantum=beginWorkerNativeGridKernelQuantum(portfolio,contract,owner,dispatcher)
    if(!kind.endsWith("before")) mutate()
    let rejected=false
    try {
      rejected=runWorkerNativeA01BulkSearchPrototype(owner,100)===null
      strictEqual(rejected,true);strictEqual(calls,0)
      strictEqual(getWorkerNativeA01BulkSearchPrototypeDiagnostics(owner),null)
    } finally {finishWorkerNativeGridKernelQuantum(quantum)}
    strictEqual(Object.getOwnPropertyDescriptor(owner,"iterations")?.value??before,before)
    try {owner.step();throw new Error("native observer was not reached")}
    catch(error:unknown) {
      if(kind.endsWith("readonly")) strictEqual(error instanceof TypeError,true)
      else {strictEqual(error,sentinel);strictEqual(calls,1)}
    } finally {
      if(original) Object.defineProperty(target,name,original)
      else Reflect.deleteProperty(target,name)
    }
    lateObservers++
  }
  for(let seed=0;seed<6;seed++) {
    const params={nodeWithPortPoints:structuredClone(cmn45) as NodeWithPortPoints,cellSizeMm:.1,
      viaDiameter:.3,traceThickness:.1,viaMinDistFromBorder:.15,traceMargin:.1,effort:1,hyperParameters:{shuffleSeed:seed}}
    const native=new HighDensitySolverA01(structuredClone(params)),owner=new ReplayHighDensityA01Solver(structuredClone(params))
    registerWorkerNativeGridOwner(owner,dispatcher)
    native.setup();owner.setup();native.MAX_ITERATIONS=Math.min(native.MAX_ITERATIONS,160000);owner.MAX_ITERATIONS=native.MAX_ITERATIONS
    const names=Object.keys(native),heap=Object.getOwnPropertyDescriptor(owner,"heap")!.value,arrays=[heap.f,heap.seq,heap.id]
    strictEqual(runWorkerNativeA01BulkSearchPrototype(owner,100),null,"registered owner outside selected scope remains native")
    if(seed===0) {
      const descriptor=Object.getOwnPropertyDescriptor(Math,"min")!
      let calls=0
      try {
        Object.defineProperty(Math,"min",{configurable:true,get():never{calls++;throw new Error("observer")}})
        strictEqual(beginWorkerNativeGridKernelQuantum(portfolio,contract,owner,dispatcher),null)
        strictEqual(runWorkerNativeA01BulkSearchPrototype(owner,100),null);strictEqual(calls,0);lateObservers++
      } finally {Object.defineProperty(Math,"min",descriptor)}
      const quantum=beginWorkerNativeGridKernelQuantum(portfolio,contract,owner,dispatcher)
      strictEqual(quantum!==null,true)
      const method=Object.getOwnPropertyDescriptor(NativeA01BulkSearchKernel.prototype,"runActiveSearch")!
      try {
        Object.defineProperty(NativeA01BulkSearchKernel.prototype,"runActiveSearch",{configurable:true,get():never{calls++;throw new Error("backend observer")}})
        strictEqual(runWorkerNativeA01BulkSearchPrototype(owner,100),null);strictEqual(calls,0);lateObservers++
      } finally {Object.defineProperty(NativeA01BulkSearchKernel.prototype,"runActiveSearch",method);finishWorkerNativeGridKernelQuantum(quantum)}
    }
    while(!native.solved&&!native.failed) {
      let quantum=beginWorkerNativeGridKernelQuantum(portfolio,contract,owner,dispatcher)
      strictEqual(quantum!==null,true);strictEqual(isWorkerNativeGridKernelQuantumActive(owner),true)
      try {
        let offset=0
        while(offset<100) {
          if(owner.solved||owner.failed) {native.step();owner.step();offset++;continue}
          const result=runWorkerNativeA01BulkSearchPrototype(owner,100-offset)
          strictEqual(result!==null,true,"authentic experimental backend must really be admitted")
          for(let index=0;index<result!.consumed;index++) native.step()
          offset+=result!.consumed
          deepStrictEqual(nativeFields(owner,names),nativeFields(native,names));frontiers++
          if(offset<100&&result!.event!=="limit") {
            // Flush/leave every fast helper BEFORE original start, goal, budget,
            // cap or error formatting. Resume only under a newly checked scope.
            finishWorkerNativeGridKernelQuantum(quantum);quantum=null
            strictEqual(isWorkerNativeGridKernelQuantumActive(owner),false)
            native.step();owner.step();offset++
            deepStrictEqual(nativeFields(owner,names),nativeFields(native,names))
            if(offset<100&&!owner.solved&&!owner.failed) {
              quantum=beginWorkerNativeGridKernelQuantum(portfolio,contract,owner,dispatcher)
              strictEqual(quantum!==null,true)
            }
          }
        }
      } finally {finishWorkerNativeGridKernelQuantum(quantum)}
      strictEqual(isWorkerNativeGridKernelQuantumActive(owner),false)
      strictEqual(runWorkerNativeA01BulkSearchPrototype(owner,100),null)
      strictEqual(Object.getOwnPropertyDescriptor(owner,"heap")!.value,heap)
      strictEqual(heap.f,arrays[0]);strictEqual(heap.seq,arrays[1]);strictEqual(heap.id,arrays[2])
      deepStrictEqual(nativeFields(owner,names),nativeFields(native,names));deepStrictEqual(owner.getOutput(),native.getOutput())
      checkpoints++
    }
    strictEqual(owner.iterations,seed===5?157175:160000)
    const diagnostics=getWorkerNativeA01BulkSearchPrototypeDiagnostics(owner)!
    strictEqual(diagnostics.consumed>0,true);steps+=owner.iterations;bulkSteps+=diagnostics.consumed
    batches+=diagnostics.batches;heapPops+=diagnostics.heapPops;heapPushes+=diagnostics.heapPushes
  }
  return {actualWorker:true,steps,checkpoints,frontiers,bulkSteps,batches,heapPops,heapPushes,
    lateObservers,noDefaultActivation:true,noLeaseAfterQuantum:true}
}
onmessage=():void=>{
  runOracle().then((result):void=>postMessage({result}),
    (error:unknown):void=>postMessage({error:String(error)}))
}
