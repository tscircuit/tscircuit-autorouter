import { deepStrictEqual,strictEqual } from "node:assert"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { WorkerHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/high-density-a01-fork/WorkerHighDensityA01Solver"
import { initializeWorkerNativeGridRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridRuntime"
import { createWorkerNativeA01HistoryBulkTask,registerWorkerNativeA01HistoryBulkOwner,
  runWorkerNativeA01HistoryBulkPrototype,retireWorkerNativeA01HistoryBulkTask,getWorkerNativeA01HistoryBulkDiagnostics,
  type WorkerNativeA01HistoryBulkTask } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-history-bulk-search/workerNativeA01HistoryBulkPrototype"
import { snapshotNativeGridHistory,type NativeGridHistorySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import type { GridHistoryJob,GridHistorySnapshot } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"

type A01Job=GridHistoryJob&{algorithm:"a01"}
type Heap={f:number[];seq:number[];id:number[];n:number}
type State={heap:Heap;nodePool:object[];viaOccupantsByCell:Map<number,readonly number[]>}

function nativeFields(solver:NativeGridHistorySolver,names:readonly string[]):object {
  const descriptors=Object.getOwnPropertyDescriptors(solver),fields:Record<string,unknown>={}
  for(let index=0;index<names.length;index++) {
    const name=names[index]!,value=descriptors[name]!.value
    // The existing exact worker fork retains a distinct private heap class.
    // Compare its full numeric own state, plus explicit heap/array identities.
    fields[name]=name==="heap"?{...value}:value
  }
  return fields
}

function makeJob(template:A01Job,seed:number):A01Job {
  const job=structuredClone(template)
  job.candidateId=seed
  job.params.hyperParameters={...job.params.hyperParameters,shuffleSeed:seed}
  job.cancellationBuffer=new SharedArrayBuffer(4)
  return job
}

function makeOwner(job:A01Job):WorkerHighDensityA01Solver {
  const owner=new WorkerHighDensityA01Solver(structuredClone(job.params))
  owner.setup()
  strictEqual(job.maxIterations<=owner.MAX_ITERATIONS,true)
  owner.MAX_ITERATIONS=job.maxIterations
  return owner
}

function runNegativeCases(template:A01Job):number {
  let cases=0
  const sentinel=new Error("history native observer")
  for(const kind of ["step-data","step-getter","computeH","heap-getter","heap-row-getter","node-getter","counter-readonly","numeric-object","atomic-getter","atomic-method"]) {
    const job=makeJob(template,0),owner=makeOwner(job),task=createWorkerNativeA01HistoryBulkTask(job)!
    strictEqual(task!==null,true);strictEqual(registerWorkerNativeA01HistoryBulkOwner(task,owner),true);owner.step()
    const host=owner as unknown as State,before=owner.iterations
    let target:object=owner,name="step",calls=0
    if(kind==="computeH") {target=WorkerHighDensityA01Solver.prototype;name="computeH"}
    if(kind==="heap-getter") name="heap"
    if(kind==="heap-row-getter") {target=host.heap.f;name="0"}
    if(kind==="node-getter") {target=host.nodePool[0]!;name="g"}
    if(kind==="counter-readonly") name="iterations"
    if(kind==="numeric-object") name="cellSizeMm"
    if(kind.startsWith("atomic")) {target=Atomics;name="load"}
    const original=Object.getOwnPropertyDescriptor(target,name),originalStep=owner.step
    try {
      if(kind==="counter-readonly") Object.defineProperty(target,name,{...original,writable:false})
      else if(kind==="numeric-object") Object.defineProperty(target,name,{...original,value:{valueOf():never{calls++;throw sentinel}}})
      else if(kind==="step-data") Object.defineProperty(target,name,{configurable:true,value():void{calls++;Reflect.apply(originalStep,owner,[])}})
      else if(kind==="atomic-method") Object.defineProperty(target,name,{...original,value():never{calls++;throw sentinel}})
      else Object.defineProperty(target,name,{configurable:true,enumerable:original?.enumerable??false,get():never{calls++;throw sentinel}})
      strictEqual(runWorkerNativeA01HistoryBulkPrototype(task,owner,100),null);strictEqual(calls,0)
      strictEqual(Object.getOwnPropertyDescriptor(owner,"iterations")!.value,before)
      strictEqual(getWorkerNativeA01HistoryBulkDiagnostics(task)!.active,false)
      if(kind==="step-data") {owner.step();strictEqual(calls,1)}
      else if(kind.startsWith("atomic")) {
        try {Atomics.load(new Int32Array(job.cancellationBuffer!),0);throw new Error("native atomic observer missing")}
        catch(error:unknown) {strictEqual(error,sentinel);strictEqual(calls,1)}
      }
      cases++
    } finally {
      if(original) Object.defineProperty(target,name,original)
      else Reflect.deleteProperty(target,name)
      retireWorkerNativeA01HistoryBulkTask(task)
    }
  }
  const job=makeJob(template,0),owner=makeOwner(job)
  let traps=0
  const proxy=new Proxy(job,{getPrototypeOf():object {traps++;throw sentinel},ownKeys():string[]{traps++;throw sentinel}})
  strictEqual(createWorkerNativeA01HistoryBulkTask(proxy),null);strictEqual(traps,0);cases++
  const params=Object.getOwnPropertyDescriptor(job,"params")!
  try {
    Object.defineProperty(job,"params",{configurable:true,get():never{traps++;throw sentinel}})
    strictEqual(createWorkerNativeA01HistoryBulkTask(job),null);strictEqual(traps,0);cases++
  } finally {Object.defineProperty(job,"params",params)}
  strictEqual(runWorkerNativeA01HistoryBulkPrototype({} as WorkerNativeA01HistoryBulkTask,owner,100),null);cases++
  const task=createWorkerNativeA01HistoryBulkTask(job)!
  strictEqual(registerWorkerNativeA01HistoryBulkOwner(task,owner),true)
  retireWorkerNativeA01HistoryBulkTask(task)
  strictEqual(runWorkerNativeA01HistoryBulkPrototype(task,owner,100),null)
  strictEqual(getWorkerNativeA01HistoryBulkDiagnostics(task)!.retired,true);cases++
  return cases
}

function runCancellationCases(template:A01Job):number {
  let cases=0
  for(const prefix of [0,1,17,53,99,100,101]) {
    const job=makeJob(template,0),owner=makeOwner(job),reference=makeOwner(job),task=createWorkerNativeA01HistoryBulkTask(job)!
    strictEqual(registerWorkerNativeA01HistoryBulkOwner(task,owner),true)
    const flag=new Int32Array(job.cancellationBuffer!),names=Object.keys(reference)
    let referenceLoads=0
    while(owner.iterations<prefix) {
      const result=runWorkerNativeA01HistoryBulkPrototype(task,owner,Math.min(100,prefix-owner.iterations))!
      strictEqual(result!==null,true)
      for(let index=0;index<result.consumed;index++) {referenceLoads++;strictEqual(Atomics.load(flag,0),0);reference.step()}
      if(result.cancellationChecked) {
        referenceLoads++;strictEqual(Atomics.load(flag,0),0)
        reference.step();owner.step()
      }
      deepStrictEqual(nativeFields(owner,names),nativeFields(reference,names))
    }
    Atomics.store(flag,0,1)
    const before=owner.iterations,result=runWorkerNativeA01HistoryBulkPrototype(task,owner,100)!
    referenceLoads++;strictEqual(Atomics.load(flag,0),1)
    strictEqual(result.event,"cancel");strictEqual(result.consumed,0);strictEqual(result.cancellationChecked,true)
    strictEqual(owner.iterations,before);deepStrictEqual(nativeFields(owner,names),nativeFields(reference,names))
    const diagnostics=getWorkerNativeA01HistoryBulkDiagnostics(task)!
    strictEqual(diagnostics.atomicLoads,referenceLoads);strictEqual(diagnostics.active,false)
    retireWorkerNativeA01HistoryBulkTask(task);cases++
  }
  return cases
}

async function runOracle(template:A01Job):Promise<object> {
  await initializeWorkerNativeGridRuntime()
  const negativeCases=runNegativeCases(template),cancellationCases=runCancellationCases(template)
  let steps=0,checkpoints=0,frontiers=0,pureSteps=0,batches=0,atomicLoads=0,events=0
  for(let seed=0;seed<6;seed++) {
    const job=makeJob(template,seed),owner=makeOwner(job),reference=makeOwner(job)
    const original=new HighDensitySolverA01(structuredClone(job.params))
    original.setup();original.MAX_ITERATIONS=job.maxIterations
    const task=createWorkerNativeA01HistoryBulkTask(job)!
    strictEqual(task!==null,true);strictEqual(registerWorkerNativeA01HistoryBulkOwner(task,owner),true)
    const names=Object.keys(reference),originalNames=Object.keys(original),host=owner as unknown as State
    const heap=host.heap,arrays=[heap.f,heap.seq,heap.id],flag=new Int32Array(job.cancellationBuffer!)
    const expected:GridHistorySnapshot[]=[],actual:GridHistorySnapshot[]=[]
    let referenceLoads=0
    deepStrictEqual(snapshotNativeGridHistory(owner),snapshotNativeGridHistory(original))
    while(!reference.solved&&!reference.failed) {
      const oldPool=host.nodePool,oldNodes=host.nodePool.slice(),oldCache=[...host.viaOccupantsByCell]
      const result=runWorkerNativeA01HistoryBulkPrototype(task,owner,100-owner.iterations%100)!
      strictEqual(result!==null,true);strictEqual(result.event!=="cancel",true)
      for(let index=0;index<result.consumed;index++) {
        referenceLoads++;strictEqual(Atomics.load(flag,0),0);reference.step();original.step()
        if(reference.iterations%100===0||reference.solved||reference.failed) expected.push(snapshotNativeGridHistory(reference))
      }
      strictEqual(host.heap,heap);strictEqual(host.nodePool,oldPool)
      for(let index=0;index<arrays.length;index++) strictEqual([heap.f,heap.seq,heap.id][index],arrays[index])
      for(let index=0;index<oldNodes.length;index++) strictEqual(host.nodePool[index],oldNodes[index])
      for(let index=0;index<oldCache.length;index++) strictEqual(host.viaOccupantsByCell.get(oldCache[index]![0]),oldCache[index]![1])
      deepStrictEqual(nativeFields(owner,names),nativeFields(reference,names))
      deepStrictEqual(nativeFields(owner,originalNames),nativeFields(original,originalNames));frontiers++
      if(result.event!=="limit"&&result.event!=="terminal") {
        strictEqual(result.cancellationChecked,true)
        referenceLoads++;strictEqual(Atomics.load(flag,0),0)
        strictEqual(getWorkerNativeA01HistoryBulkDiagnostics(task)!.active,false)
        reference.step();original.step();owner.step();events++
        if(reference.iterations%100===0||reference.solved||reference.failed) expected.push(snapshotNativeGridHistory(reference))
        deepStrictEqual(nativeFields(owner,names),nativeFields(reference,names))
        deepStrictEqual(nativeFields(owner,originalNames),nativeFields(original,originalNames))
      }
      if(owner.iterations%100===0||owner.solved||owner.failed) actual.push(snapshotNativeGridHistory(owner))
      strictEqual(getWorkerNativeA01HistoryBulkDiagnostics(task)!.active,false)
    }
    deepStrictEqual(actual,expected);deepStrictEqual(owner.getOutput(),original.getOutput())
    strictEqual(owner.iterations,seed===5?157175:160000)
    const diagnostics=getWorkerNativeA01HistoryBulkDiagnostics(task)!
    strictEqual(diagnostics.atomicLoads,referenceLoads);strictEqual(referenceLoads,owner.iterations)
    strictEqual(diagnostics.kernel!.consumed>0,true)
    steps+=owner.iterations;checkpoints+=actual.length;pureSteps+=diagnostics.kernel!.consumed
    batches+=diagnostics.kernel!.batches;atomicLoads+=diagnostics.atomicLoads
    retireWorkerNativeA01HistoryBulkTask(task)
    strictEqual(runWorkerNativeA01HistoryBulkPrototype(task,owner,100),null)
    strictEqual(getWorkerNativeA01HistoryBulkDiagnostics(task)!.active,false)
  }
  return {actualWorker:true,steps,checkpoints,frontiers,pureSteps,batches,atomicLoads,events,
    negativeCases,cancellationCases,defaultHistoryUntouched:true,ordinaryReplayCapabilityUsed:false,noLeaseAfterRun:true}
}

onmessage=(event:MessageEvent<A01Job>):void=>{
  runOracle(event.data).then((result):void=>postMessage({result}),
    (error:unknown):void=>postMessage({error:error instanceof Error?error.stack:String(error)}))
}
