import type { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01BulkSearchKernel, type NativeA01BulkSearchResult } from "./NativeA01BulkSearchKernel"
import { hasNativeGridKernelIntrinsics } from "../nativeGridKernelIntrinsics"
import { isWorkerNativeGridKernelQuantumActive } from "../workerNativeGridKernelQuantum"
import { nativeOwnerDescriptor, nativeOwnerHasOwn, nativeOwnerIs, nativeOwnerPrototype } from "../nativeOwnerKernelContract"
import { hasParallelNativeA01HeapEligibility } from "../installParallelNativeA01Heap"
import { isWorkerNativeGridProxy } from "../workerNativeGridRuntime"
import { getNativeDescriptorMap, nativeDescriptorMapKeys } from "../nativeDescriptorMetadataGuard"

type Snapshot={target:object;parent:object|null;names:readonly PropertyKey[];descriptors:readonly PropertyDescriptor[]}
const nativeExtensible=Object.isExtensible,nativeArray=Array.isArray
const targets=[NativeA01BulkSearchKernel,NativeA01BulkSearchKernel.prototype]
const snapshots:Snapshot[]=[]
const kernels=new WeakMap<HighDensitySolverA01,NativeA01BulkSearchKernel>()
const getKernel=kernels.get.bind(kernels),setKernel=kernels.set.bind(kernels)
for(let level=0;level<targets.length;level++) {
  const target=targets[level]!,map=getNativeDescriptorMap(target),names=nativeDescriptorMapKeys(map)
  const descriptors:PropertyDescriptor[]=[]
  for(let index=0;index<names.length;index++) descriptors[index]=map[names[index]!]!
  snapshots[level]={target,parent:nativeOwnerPrototype(target),names,descriptors}
}

/** Conservative experimental guard; the default native pipeline never calls it. */
function hasOriginalBulkSearchBackend():boolean {
  // This deliberately retains the entire existing JS+WASM guard. A smaller
  // backend inventory needs its own callback proof; no default guard is narrowed.
  if(!hasNativeGridKernelIntrinsics(undefined,true)) return false
  for(let level=0;level<snapshots.length;level++) {
    const snapshot=snapshots[level]!,map=getNativeDescriptorMap(snapshot.target)
    if(nativeOwnerPrototype(snapshot.target)!==snapshot.parent || nativeDescriptorMapKeys(map).length!==snapshot.names.length) return false
    for(let index=0;index<snapshot.names.length;index++) {
      const current=map[snapshot.names[index]!],original=snapshot.descriptors[index]!
      if(!current || !nativeOwnerIs(current.value,original.value) || current.get!==original.get || current.set!==original.set ||
        current.writable!==original.writable || current.enumerable!==original.enumerable || current.configurable!==original.configurable) return false
    }
  }
  return true
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
function hasWritableNativeBulkState(owner:HighDensitySolverA01):boolean {
  const descriptors=getNativeDescriptorMap(owner),names=nativeDescriptorMapKeys(descriptors)
  for(let index=0;index<names.length;index++) if(!nativeOwnerHasOwn(descriptors[names[index]!]!,"value")) return false
  const writes=["iterations","searchIterations","seqCounter","_moveCost","_moveRipped"]
  for(let index=0;index<writes.length;index++) {
    const current=descriptors[writes[index]!]!
    if(!current || current.writable!==true) return false
  }
  const heap=descriptors.heap!.value as object,heapFields=getNativeDescriptorMap(heap)
  if(heapFields.n?.writable!==true) return false
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
  }
  const nodePool=descriptors.nodePool!.value as {ripped:unknown}[],heapIds=heapFields.id!.value as number[]
  const n=heapFields.n!.value as number,heads:unknown[]=[],seen=new WeakSet<object>()
  for(let index=0;index<n;index++) {
    const node=nodePool[heapIds[index]!]!
    if(!hasNativeDataRecord(node,["z","row","col","g","f","parentIdx","ripped"])) return false
    heads.push(node.ripped)
  }
  while(heads.length) {
    const head=heads.pop()
    if(head===null) continue
    if(!hasNativeDataRecord(head,["id","prev"])) return false
    if(seen.has(head as object)) continue
    seen.add(head as object);heads.push((head as {prev:unknown}).prev)
  }
  if(!hasNativeDataArray(descriptors.ripCount!.value) || !hasNativeDataArray(descriptors.connIdToRootNet!.value)) return false
  for(const occupants of (descriptors.viaOccupantsByCell!.value as Map<number,readonly number[]>).values()) {
    if(!hasNativeDataArray(occupants)) return false
  }
  return true
}

/** Eligibility is a backend domain check, never a different routing policy. */
function hasBoundedNativeBulkDomain(owner:HighDensitySolverA01):boolean {
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

/** Isolated prototype, admitted only inside the genuine selected worker quantum. */
export function runWorkerNativeA01BulkSearchPrototype(owner:HighDensitySolverA01,
  maxLogicalSteps:number):NativeA01BulkSearchResult|null {
  if(!isWorkerNativeGridKernelQuantumActive(owner) || !hasOriginalBulkSearchBackend() ||
    !hasParallelNativeA01HeapEligibility(owner) || !hasWritableNativeBulkState(owner) || !hasBoundedNativeBulkDomain(owner)) return null
  let kernel=getKernel(owner)
  if(!kernel) {
    kernel=new NativeA01BulkSearchKernel(owner)
    setKernel(owner,kernel)
  }
  // Each run snapshots current native contents and flushes before any JS event.
  // A new event/run repeats this conservative guard; no lease crosses an await.
  return kernel.runActiveSearch(owner,maxLogicalSteps)
}

export function getWorkerNativeA01BulkSearchPrototypeDiagnostics(owner:HighDensitySolverA01):
  Readonly<NativeA01BulkSearchKernel["diagnostics"]>|null {
  const kernel=getKernel(owner)
  if(!kernel) return null
  const descriptors=Object.getOwnPropertyDescriptors(kernel.diagnostics),result:Record<string,number>={}
  const names=Object.keys(descriptors)
  for(let index=0;index<names.length;index++) result[names[index]!]=descriptors[names[index]!]!.value
  return result as NativeA01BulkSearchKernel["diagnostics"]
}
