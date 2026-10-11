import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { WorkerHighDensityA01Solver } from "../high-density-a01-fork/WorkerHighDensityA01Solver"
import { NativeA01HistoryBulkSearchKernel,type NativeA01HistoryBulkSearchResult } from "./NativeA01HistoryBulkSearchKernel"
import type { GridHistoryJob } from "../parallelGridHistoryTypes"
import { nativeOwnerDescriptor,nativeOwnerHasOwn,nativeOwnerIs,nativeOwnerPrototype,hasNativeOwnerNumericPolicy } from "../nativeOwnerKernelContract"
import { hasNativeGridKernelIntrinsics } from "../nativeGridKernelIntrinsics"
import { captureNativeGridOwnerStorage,hasNativeGridOwnerStorage,type NativeGridOwnerStorage } from "../nativeGridOwnerStorage"
import { hasWorkerNativeGridRuntime,isWorkerNativeGridProxy } from "../workerNativeGridRuntime"
import { hasNativeDescriptorMetadata,getNativeDescriptorMap,nativeDescriptorMapKeys } from "../nativeDescriptorMetadataGuard"

type Snapshot={target:object;parent:object|null;names:readonly PropertyKey[];descriptors:readonly PropertyDescriptor[]}
export type WorkerNativeA01HistoryBulkTask={readonly historyWorkerTask:unique symbol}
type NativeHeap={f:number[];seq:number[];id:number[];n:number}
type OwnerState={owner:WorkerHighDensityA01Solver;storage:NativeGridOwnerStorage;heap:NativeHeap;
  arrays:readonly number[][];rows:number;cols:number;layers:number;connections:number;active:boolean;kernel?:NativeA01HistoryBulkSearchKernel}
type TaskState={maxIterations:number;cancellation?:Int32Array;retired:boolean;atomicLoads:number;logicalChecks:number;owner?:OwnerState}
const nativeExtensible=Object.isExtensible,nativeArray=Array.isArray
const snapshots:Snapshot[]=[]
const tasks=new WeakMap<WorkerNativeA01HistoryBulkTask,TaskState>()
const getTask=tasks.get.bind(tasks),setTask=tasks.set.bind(tasks)
const nativeAtomicsDescriptor=nativeOwnerDescriptor(globalThis,"Atomics")!
const nativeSharedDescriptor=nativeOwnerDescriptor(globalThis,"SharedArrayBuffer")!
const capturedAtomicLoad=Atomics.load
const capturedApply=Reflect.apply
const targets:object[]=[NativeA01HistoryBulkSearchKernel,NativeA01HistoryBulkSearchKernel.prototype,
  WorkerHighDensityA01Solver,WorkerHighDensityA01Solver.prototype,HighDensitySolverA01,HighDensitySolverA01.prototype,
  Atomics,SharedArrayBuffer,SharedArrayBuffer.prototype]
const probe=new WorkerHighDensityA01Solver({nodeWithPortPoints:{capacityMeshNodeId:"history_a01_storage_probe",center:{x:0,y:0},
  width:.1,height:.1,availableZ:[0],portPoints:[]},cellSizeMm:.1,viaDiameter:.3})
probe.setup()
const heapPrototype=nativeOwnerPrototype(nativeOwnerDescriptor(probe,"heap")!.value)
targets[targets.length]=heapPrototype
for(let index=0;index<targets.length;index++) captureSnapshotChain(targets[index]!)

function captureSnapshotChain(target:object):void {
  let current:object|null=target
  while(current) {
    let seen=false
    for(let index=0;index<snapshots.length;index++) if(snapshots[index]!.target===current) seen=true
    if(seen) return
    const map=getNativeDescriptorMap(current),names=nativeDescriptorMapKeys(map),descriptors:PropertyDescriptor[]=[]
    for(let index=0;index<names.length;index++) descriptors[index]=map[names[index]!]!
    const parent=nativeOwnerPrototype(current)
    snapshots[snapshots.length]={target:current,parent,names,descriptors};current=parent
  }
}

/** Full original callback/storage provenance, independent of ordinary Replay. */
function hasHistoryBackendContract():boolean {
  if(!hasNativeDescriptorMetadata()||!hasNativeGridKernelIntrinsics(undefined,true)) return false
  const atomic=nativeOwnerDescriptor(globalThis,"Atomics"),shared=nativeOwnerDescriptor(globalThis,"SharedArrayBuffer")
  if(!atomic||atomic.value!==nativeAtomicsDescriptor.value||atomic.get||atomic.set||
    !shared||shared.value!==nativeSharedDescriptor.value||shared.get||shared.set) return false
  for(let level=0;level<snapshots.length;level++) {
    const snapshot=snapshots[level]!,map=getNativeDescriptorMap(snapshot.target)
    if(nativeOwnerPrototype(snapshot.target)!==snapshot.parent||nativeDescriptorMapKeys(map).length!==snapshot.names.length) return false
    for(let index=0;index<snapshot.names.length;index++) {
      const current=map[snapshot.names[index]!],original=snapshot.descriptors[index]!
      if(!current||!nativeOwnerIs(current.value,original.value)||current.get!==original.get||current.set!==original.set||
        current.writable!==original.writable||current.enumerable!==original.enumerable||current.configurable!==original.configurable) return false
    }
  }
  return true
}

/** Descriptor-only serialized task data cannot execute caller-owned observers. */
function hasPlainHistoryInputs(value:unknown,seen:WeakSet<object>):boolean {
  if(value===null||value===undefined||typeof value==="number"||typeof value==="string"||typeof value==="boolean") return true
  if(typeof value!=="object"||isWorkerNativeGridProxy(value)) return false
  if(seen.has(value)) return true
  const prototype=nativeOwnerPrototype(value)
  if(prototype!==Object.prototype&&prototype!==Array.prototype&&prototype!==null) return false
  seen.add(value)
  const map=getNativeDescriptorMap(value),names=nativeDescriptorMapKeys(map)
  for(let index=0;index<names.length;index++) {
    const current=map[names[index]!]!
    if(typeof names[index]==="symbol"||!nativeOwnerHasOwn(current,"value")||!hasPlainHistoryInputs(current.value,seen)) return false
  }
  return true
}

/** Mint only at an actual callback-free structured-clone history Worker entry. */
export function createWorkerNativeA01HistoryBulkTask(job:GridHistoryJob):WorkerNativeA01HistoryBulkTask|null {
  if(!hasWorkerNativeGridRuntime()||!hasHistoryBackendContract()||isWorkerNativeGridProxy(job)||nativeOwnerPrototype(job)!==Object.prototype) return null
  const map=getNativeDescriptorMap(job),names=nativeDescriptorMapKeys(map),seen=new WeakSet<object>()
  for(let index=0;index<names.length;index++) {
    const name=names[index]!,current=map[name]!
    if(typeof name==="symbol"||!nativeOwnerHasOwn(current,"value")) return null
    if(name!=="cancellationBuffer"&&!hasPlainHistoryInputs(current.value,seen)) return null
  }
  if(map.kind?.value!=="gridHistory"||map.algorithm?.value!=="a01"||!map.params?.value||
    !Number.isSafeInteger(map.candidateId?.value)||map.candidateId!.value<0||
    !Number.isSafeInteger(map.maxIterations?.value)||map.maxIterations!.value<1||
    !Number.isSafeInteger(map.ownerIterations?.value)||map.ownerIterations!.value<0||
    map.ownerIterations!.value>=map.maxIterations!.value||map.ownerIterations!.value%100!==0) return null
  const buffer=map.cancellationBuffer?.value as SharedArrayBuffer|undefined
  if(buffer!==undefined&&(isWorkerNativeGridProxy(buffer)||nativeOwnerPrototype(buffer)!==SharedArrayBuffer.prototype||buffer.byteLength!==4)) return null
  const task={} as WorkerNativeA01HistoryBulkTask
  setTask(task,{maxIterations:map.maxIterations!.value,cancellation:buffer===undefined?undefined:new Int32Array(buffer),retired:false,atomicLoads:0,logicalChecks:0})
  return task
}

/** One original candidate setup; no duplicate construction or ordinary token. */
export function registerWorkerNativeA01HistoryBulkOwner(task:WorkerNativeA01HistoryBulkTask,
  owner:WorkerHighDensityA01Solver):boolean {
  const state=getTask(task)
  if(!state||state.retired||state.owner||!hasHistoryBackendContract()||isWorkerNativeGridProxy(owner)||
    nativeOwnerPrototype(owner)!==WorkerHighDensityA01Solver.prototype) return false
  const map=getNativeDescriptorMap(owner)
  if(map._setupDone?.value!==true||map.MAX_ITERATIONS?.value!==state.maxIterations) return false
  if(!hasNativeWorkerOwnerMethods(owner)||!hasWritableNativeBulkState(owner)||!hasBoundedNativeBulkDomain(owner)) return false
  const heap=map.heap!.value as NativeHeap
  if(isWorkerNativeGridProxy(heap)||nativeOwnerPrototype(heap)!==heapPrototype) return false
  state.owner={owner,storage:captureNativeGridOwnerStorage(owner,"heap"),heap,arrays:[heap.f,heap.seq,heap.id],
    rows:map.rows!.value,cols:map.cols!.value,layers:map.layers!.value,connections:map.connIdToRootNet!.value.length,active:false}
  return true
}

/** All inherited Base callbacks and optional progress hooks remain native. */
function hasNativeWorkerOwnerMethods(owner:WorkerHighDensityA01Solver):boolean {
  if(isWorkerNativeGridProxy(owner)||nativeOwnerPrototype(owner)!==WorkerHighDensityA01Solver.prototype||
    nativeOwnerHasOwn(owner,"computeProgress")) return false
  let prototype:object|null=WorkerHighDensityA01Solver.prototype
  while(prototype) {
    const names=nativeDescriptorMapKeys(getNativeDescriptorMap(prototype))
    for(let index=0;index<names.length;index++) {
      if(names[index]!=="constructor"&&nativeOwnerHasOwn(owner,names[index]!)) return false
    }
    prototype=nativeOwnerPrototype(prototype)
  }
  return nativeOwnerDescriptor(owner,"initialPenaltyFn")?.value===undefined&&hasNativeOwnerNumericPolicy(owner)
}

/** Validate each pure run independently, before any native counter or C write. */
function hasRegisteredNativeOwner(state:TaskState,owner:WorkerHighDensityA01Solver):boolean {
  const registered=state.owner
  if(!registered||registered.owner!==owner||registered.active||!hasNativeWorkerOwnerMethods(owner)||
    !hasNativeGridOwnerStorage(owner,registered.storage)) return false
  const map=getNativeDescriptorMap(owner),heap=map.heap?.value as NativeHeap
  if(heap!==registered.heap||isWorkerNativeGridProxy(heap)||nativeOwnerPrototype(heap)!==heapPrototype||
    map.rows!.value!==registered.rows||map.cols!.value!==registered.cols||map.layers!.value!==registered.layers||
    map.connIdToRootNet!.value.length!==registered.connections||map.MAX_ITERATIONS!.value!==state.maxIterations) return false
  const fields=getNativeDescriptorMap(heap),heapNames=nativeDescriptorMapKeys(getNativeDescriptorMap(heapPrototype))
  for(let index=0;index<heapNames.length;index++) if(nativeOwnerHasOwn(heap,heapNames[index]!)) return false
  const arrays=[fields.f?.value,fields.seq?.value,fields.id?.value]
  for(let index=0;index<arrays.length;index++) if(arrays[index]!==registered.arrays[index]||nativeOwnerPrototype(arrays[index])!==Array.prototype) return false
  return hasWritableNativeBulkState(owner)&&hasBoundedNativeBulkDomain(owner)
}

/** Native generated records have own data fields, never deferred getters. */
function hasNativeDataRecord(value:unknown,required:readonly string[]):boolean {
  if(!value || typeof value!=="object" || isWorkerNativeGridProxy(value)) return false
  const map=getNativeDescriptorMap(value),names=nativeDescriptorMapKeys(map)
  for(let index=0;index<names.length;index++) if(!nativeOwnerHasOwn(map[names[index]!]!,"value")) return false
  for(let index=0;index<required.length;index++) if(!map[required[index]!]) return false
  return true
}

/** Read-only cached/geometry arrays may be sparse but cannot call observers. */
function hasNativeDataArray(value:unknown):boolean {
  if(isWorkerNativeGridProxy(value) || !nativeArray(value)) return false
  const map=getNativeDescriptorMap(value),names=nativeDescriptorMapKeys(map)
  for(let index=0;index<names.length;index++) {
    if(!nativeOwnerHasOwn(map[names[index]!]!,"value")) return false
  }
  return true
}

/** Check every descriptor that the bridge can read or publish before work. */
function hasWritableNativeBulkState(owner:WorkerHighDensityA01Solver):boolean {
  const descriptors=getNativeDescriptorMap(owner),names=nativeDescriptorMapKeys(descriptors)
  for(let index=0;index<names.length;index++) if(!nativeOwnerHasOwn(descriptors[names[index]!]!,"value")) return false
  const numbers=["rows","cols","layers","planeSize","stamp","activeConnId","minViaRow","maxViaRow","minViaCol","maxViaCol",
    "ripHistoryCostMultiplier","searchIterations","seqCounter","penaltyCap","baseSearchBudgetIters","cellSizeMm","stepMultiplier",
    "iterations","MAX_ITERATIONS","_moveCost"]
  for(let index=0;index<numbers.length;index++) if(typeof descriptors[numbers[index]!]!.value!=="number") return false
  for(const name of ["solved","failed","_setupDone","crossLayerSearch"]) if(typeof descriptors[name]!.value!=="boolean") return false
  const writes=["iterations","searchIterations","seqCounter","_moveCost","_moveRipped"]
  for(let index=0;index<writes.length;index++) {
    const current=descriptors[writes[index]!]!
    if(!current || current.writable!==true) return false
  }
  const heap=descriptors.heap!.value as object,heapFields=getNativeDescriptorMap(heap)
  if(heapFields.n?.writable!==true||!Number.isSafeInteger(heapFields.n.value)||heapFields.n.value<0) return false
  const arrays=[heapFields.f?.value,heapFields.seq?.value,heapFields.id?.value,
    descriptors.nodePool!.value,descriptors._viaOccs!.value]
  for(let index=0;index<arrays.length;index++) {
    const array=arrays[index]
    if(isWorkerNativeGridProxy(array) || !nativeArray(array) || !nativeExtensible(array)) return false
    const map=getNativeDescriptorMap(array),arrayNames=nativeDescriptorMapKeys(map)
    if(map.length?.writable!==true) return false
    for(let keyIndex=0;keyIndex<arrayNames.length;keyIndex++) {
      const current=map[arrayNames[keyIndex]!]!
      if(!nativeOwnerHasOwn(current,"value") || current.writable!==true) return false
    }
  }
  const segment=descriptors.activeConnSeg!.value
  if(segment!==null) {
    if(isWorkerNativeGridProxy(segment)) return false
    const map=getNativeDescriptorMap(segment),segmentNames=nativeDescriptorMapKeys(map)
    for(let index=0;index<segmentNames.length;index++) if(!nativeOwnerHasOwn(map[segmentNames[index]!]!,"value")) return false
    for(const name of ["endZ","endRow","endCol"]) if(!Number.isSafeInteger(map[name]?.value)) return false
  }
  const nodePool=descriptors.nodePool!.value as {ripped:unknown}[],heapIds=heapFields.id!.value as number[]
  const n=heapFields.n!.value as number,heads:unknown[]=[descriptors._moveRipped!.value],seen=new WeakSet<object>()
  if(n>heapIds.length) return false
  for(let index=0;index<n;index++) {
    const node=nodePool[heapIds[index]!]!
    if(!hasNativeDataRecord(node,["z","row","col","g","f","parentIdx","ripped"])) return false
    for(const name of ["z","row","col","g","f","parentIdx"]) if(typeof (node as unknown as Record<string,unknown>)[name]!=="number") return false
    heads.push(node.ripped)
  }
  while(heads.length) {
    const head=heads.pop()
    if(head===null) continue
    if(!hasNativeDataRecord(head,["id","prev"])) return false
    const rip=head as {id:unknown;prev:unknown}
    if(!Number.isSafeInteger(rip.id)||typeof rip.id!=="number"||rip.id<0||rip.id>=descriptors.connIdToRootNet!.value.length) return false
    if(seen.has(head as object)) continue
    seen.add(head as object);heads.push((head as {prev:unknown}).prev)
  }
  if(!hasNativeDataArray(descriptors.ripCount!.value) || !hasNativeDataArray(descriptors.connIdToRootNet!.value)) return false
  const ripCounts=descriptors.ripCount!.value as unknown[],roots=descriptors.connIdToRootNet!.value as unknown[],scratch=descriptors._viaOccs!.value as unknown[]
  for(let index=0;index<ripCounts.length;index++) if(typeof ripCounts[index]!=="number") return false
  for(let index=0;index<roots.length;index++) if(typeof roots[index]!=="string") return false
  for(let index=0;index<scratch.length;index++) if(typeof scratch[index]!=="number") return false
  for(const occupants of (descriptors.viaOccupantsByCell!.value as Map<number,readonly number[]>).values()) {
    if(!hasNativeDataArray(occupants)) return false
    for(let index=0;index<occupants.length;index++) if(typeof occupants[index]!=="number") return false
  }
  return true
}

/** Eligibility is a backend domain check, never a different routing policy. */
function hasBoundedNativeBulkDomain(owner:WorkerHighDensityA01Solver):boolean {
  const data=getNativeDescriptorMap(owner)
  const rows=data.rows!.value as number,cols=data.cols!.value as number,layers=data.layers!.value as number
  const states=rows*cols*layers,plane=rows*cols,capacity=1+states*(layers+7)
  const roots=data.connIdToRootNet!.value as string[],count=roots.length,offsets=data.viaOccupantScanOffsetsLen!.value as number
  if(!Number.isSafeInteger(rows)||rows<1||!Number.isSafeInteger(cols)||cols<1||!Number.isSafeInteger(layers)||layers<1||
    !Number.isSafeInteger(states)||!Number.isSafeInteger(capacity)||capacity>262144||data.stepMultiplier!.value!==1||
    (data.viaOwnersByCell!.value as Map<number,Set<number>>).size!==0||data.planeSize!.value!==plane) return false
  const diagonals=layers*(rows-1)*(cols-1)*2,ripCapacity=capacity*count
  const estimatedBytes=65536+722+capacity*68+ripCapacity*8+plane*(20+count*4)+states*12+diagonals*4+offsets*8+count*16
  if(!Number.isSafeInteger(ripCapacity)||!Number.isSafeInteger(estimatedBytes)||estimatedBytes>64*1024*1024||
    (data.usedDiagFlat!.value as Int32Array).length!==diagonals||
    (data.viaOccupantScanOffsetsDr!.value as Int32Array).length!==offsets||
    (data.viaOccupantScanOffsetsDc!.value as Int32Array).length!==offsets) return false
  return true
}

/** Pure history run: one captured atomic read before every logical attempt. */
export function runWorkerNativeA01HistoryBulkPrototype(task:WorkerNativeA01HistoryBulkTask,
  owner:WorkerHighDensityA01Solver,maxLogicalSteps:number):NativeA01HistoryBulkSearchResult|null {
  const state=getTask(task)
  if(!state||state.retired||!hasHistoryBackendContract()||!Number.isSafeInteger(maxLogicalSteps)||
    maxLogicalSteps<1||maxLogicalSteps>100||!hasRegisteredNativeOwner(state,owner)) return null
  const registered=state.owner!
  if(!registered.kernel) registered.kernel=new NativeA01HistoryBulkSearchKernel(owner,():number=>{
    state.logicalChecks++
    if(!state.cancellation) return 1
    state.atomicLoads++
    return capturedApply(capturedAtomicLoad,nativeAtomicsDescriptor.value,[state.cancellation,0])===0?1:0
  })
  registered.active=true
  try {return registered.kernel.runActiveSearch(owner,maxLogicalSteps)}
  finally {registered.active=false}
}

/** Retirement cannot leave a kernel lease live or synthesize a terminal route. */
export function retireWorkerNativeA01HistoryBulkTask(task:WorkerNativeA01HistoryBulkTask):void {
  const state=getTask(task)
  if(!state||state.retired) throw new Error("History bulk task was not minted or already retired")
  if(state.owner?.active) throw new Error("History bulk task cannot retire during native C work")
  state.retired=true
  // Native rows were flushed by every completed run and every exceptional run.
  // No owner methods, arrays, cap, output or solve flag are replaced here.
}

export function getWorkerNativeA01HistoryBulkDiagnostics(task:WorkerNativeA01HistoryBulkTask):
  Readonly<{atomicLoads:number;logicalChecks:number;active:boolean;retired:boolean;kernel:Readonly<NativeA01HistoryBulkSearchKernel["diagnostics"]>|null}>|null {
  const state=getTask(task)
  if(!state) return null
  const diagnostics=state.owner?.kernel?.diagnostics,map=diagnostics?getNativeDescriptorMap(diagnostics):undefined
  const result:Record<string,number>={}
  if(map) {
    const names=nativeDescriptorMapKeys(map)
    for(let index=0;index<names.length;index++) result[names[index]! as string]=map[names[index]!]!.value
  }
  return {atomicLoads:state.atomicLoads,logicalChecks:state.logicalChecks,active:state.owner?.active??false,
    retired:state.retired,kernel:map?result as NativeA01HistoryBulkSearchKernel["diagnostics"]:null}
}
