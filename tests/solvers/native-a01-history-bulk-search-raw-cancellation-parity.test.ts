import { deepStrictEqual, strictEqual } from "node:assert"
import { expect, test } from "bun:test"
import { WorkerHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/high-density-a01-fork/WorkerHighDensityA01Solver"
import { NativeA01HistoryBulkSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-history-bulk-search/NativeA01HistoryBulkSearchKernel"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../fixtures/parallel-grid-history-cmn45.json"

type Rip = { id: number; prev: Rip | null }
type Row = { z:number; row:number; col:number; g:number; f:number; parentIdx:number; ripped:Rip|null }
type Heap = { f:number[]; seq:number[]; id:number[]; n:number; clear():void; push(f:number,seq:number,id:number):void }
type State = { heap:Heap; nodePool:Row[]; activeConnSeg:{ endZ:number; endRow:number; endCol:number }|null;
  activeConnId:number; stamp:number; planeSize:number; searchIterations:number; baseSearchBudgetIters:number;
  usedCellsFlat:Int32Array; usedDiagFlat:Int32Array; portOwnerFlat:Int32Array; penalty2d:Float64Array;
  visitedStamp:Uint32Array; connIdToRootNet:string[]; overlapFriendlyRootNets:Set<string>;
  viaOccupantsByCell:Map<number,readonly number[]>; viaOwnersByCell:Map<number,Set<number>>;
  _viaOccs:number[]; _moveCost:number; _moveRipped:Rip|null; penaltyCap:number; seqCounter:number;
  minViaRow:number; maxViaRow:number; minViaCol:number; maxViaCol:number; ripCount:number[];
  ripHistoryCostMultiplier:number; viaOccupantScanOffsetsLen:number }
function nativeFields(solver:WorkerHighDensityA01Solver, names:readonly string[]):object {
  const fields:Record<string,unknown>={}, descriptors=Object.getOwnPropertyDescriptors(solver)
  for(let index=0;index<names.length;index++) {
    fields[names[index]!]=descriptors[names[index]!]!.value
  }
  return fields
}
function makePair(cancelAt:number):{native:WorkerHighDensityA01Solver;owner:WorkerHighDensityA01Solver;
  kernel:NativeA01HistoryBulkSearchKernel;nativeCheck:()=>number;checks:number[]} {
  const params={nodeWithPortPoints:structuredClone(cmn45) as NodeWithPortPoints,cellSizeMm:.1,
    viaDiameter:.3,traceThickness:.1,viaMinDistFromBorder:.15,traceMargin:.1,effort:1,
    hyperParameters:{shuffleSeed:0}}
  const native=new WorkerHighDensityA01Solver(structuredClone(params)),owner=new WorkerHighDensityA01Solver(structuredClone(params))
  native.setup();owner.setup();native.step();owner.step()
  const flags=[new Int32Array(new SharedArrayBuffer(4)),new Int32Array(new SharedArrayBuffer(4))],checks=[0,0]
  const load=(index:number):number=>{
    checks[index]++
    if(checks[index]===cancelAt) Atomics.store(flags[index]!,0,1)
    return Atomics.load(flags[index]!,0)===0?1:0
  }
  return {native,owner,kernel:new NativeA01HistoryBulkSearchKernel(owner,():number=>load(1)),
    nativeCheck:():number=>load(0),checks}
}
function setSingleRoot(solver:WorkerHighDensityA01Solver, visited:boolean, atGoal:boolean):void {
  const host=solver as unknown as State, goal=host.activeConnSeg!
  const row:Row={z:atGoal?goal.endZ:0,row:atGoal?goal.endRow:Math.floor(solver.rows/2),
    col:atGoal?goal.endCol:Math.floor(solver.cols/2),g:0,f:0,parentIdx:-1,ripped:null}
  host.nodePool=[row];host.heap.clear();host.heap.push(0,host.seqCounter++,0)
  host.visitedStamp.fill(0)
  if(visited) host.visitedStamp[(row.z*solver.rows+row.row)*solver.cols+row.col]=host.stamp
}
function assertRipAliases(native:WorkerHighDensityA01Solver, owner:WorkerHighDensityA01Solver):void {
  const a=native as unknown as State,b=owner as unknown as State
  const seen=new Map<Rip,Rip>(), reverse=new Map<Rip,Rip>(), stack:[Rip|null,Rip|null][]=[[a._moveRipped,b._moveRipped]]
  for(let index=0;index<a.nodePool.length;index++) stack.push([a.nodePool[index]!.ripped,b.nodePool[index]!.ripped])
  while(stack.length) {
    const [left,right]=stack.pop()!
    if(left===null || right===null) {strictEqual(left,right);continue}
    if(seen.has(left)) {strictEqual(seen.get(left),right);continue}
    strictEqual(reverse.has(right),false);seen.set(left,right);reverse.set(right,left)
    strictEqual(left.id,right.id);stack.push([left.prev,right.prev])
  }
}

test("history bulk performs the exact original atomic check before every pure/event step and flushes on cancellation or bridge error",():void=>{
  let cases=0,pureSteps=0
  const kinds=["ordinary","goal","visited-goal","budget-empty","empty","cap","visited-scratch","visited-backlog","rejected-rip"]
  for(const kind of kinds) for(const cancelAt of [1,2,17,99,101]) {
    const {native,owner,kernel,nativeCheck,checks}=makePair(cancelAt),names=Object.keys(native)
    for(const solver of [native,owner]) {
      const host=solver as unknown as State
      setSingleRoot(solver,kind==="visited-goal"||kind==="visited-scratch"||kind==="visited-backlog",kind==="goal"||kind==="visited-goal")
      if(kind==="visited-backlog") for(let index=0;index<200;index++) host.heap.push(0,host.seqCounter++,0)
      const active=host.activeConnId,other=(active+1)%host.connIdToRootNet.length
      host.usedCellsFlat.fill(-1);host.usedDiagFlat.fill(-1);host.portOwnerFlat.fill(-1)
      host._viaOccs.splice(0,host._viaOccs.length,other)
      host._moveCost=-0;host._moveRipped={id:other,prev:null}
      if(kind==="budget-empty"||kind==="empty") host.heap.clear()
      if(kind==="budget-empty") host.baseSearchBudgetIters=-1
      if(kind==="cap") solver.MAX_ITERATIONS=solver.iterations+1
      if(kind==="rejected-rip") {
        host.nodePool[0]!.ripped={id:active,prev:null}
        host.usedCellsFlat.fill(other);host.usedDiagFlat.fill(other)
      }
    }
    const host=owner as unknown as State,oldScratch=host._moveRipped,oldVia=host._viaOccs,
      oldCache=host.viaOccupantsByCell,oldTail=host.nodePool[0]!.ripped
    const result=kernel.runActiveSearch(owner,100)
    for(let index=0;index<result.consumed;index++) {strictEqual(nativeCheck(),1);native.step()}
    if(result.cancellationChecked) strictEqual(nativeCheck(),result.event==="cancel"?0:1)
    strictEqual(checks[0],checks[1]);deepStrictEqual(nativeFields(owner,names),nativeFields(native,names));assertRipAliases(native,owner)
    strictEqual(host._viaOccs,oldVia);strictEqual(host.viaOccupantsByCell,oldCache)
    if(kind==="visited-scratch"||result.consumed===0) strictEqual(host._moveRipped,oldScratch)
    if(kind==="rejected-rip"&&result.consumed>0) {
      let tail=host._moveRipped
      while(tail&&tail.prev) tail=tail.prev
      strictEqual(tail,oldTail)
    }
    if(result.event!=="limit"&&result.event!=="cancel") {
      // This original event attempt already passed the cancellation load.
      native.step();owner.step();deepStrictEqual(nativeFields(owner,names),nativeFields(native,names))
      strictEqual(checks[0],checks[1])
    }
    if(cancelAt===1) strictEqual(result.event,"cancel")
    if(kind==="visited-goal"&&cancelAt===2) {strictEqual(result.consumed,1);strictEqual(result.event,"cancel")}
    pureSteps+=result.consumed;cases++
  }
  const {native,owner}=makePair(1000),names=Object.keys(native),sentinel=new Error("atomic bridge sentinel")
  for(const solver of [native,owner]) {
    setSingleRoot(solver,true,false)
    const host=solver as unknown as State
    for(let index=0;index<30;index++) host.heap.push(0,host.seqCounter++,0)
  }
  let calls=0
  const kernel=new NativeA01HistoryBulkSearchKernel(owner,():number=>{
    calls++
    if(calls===17) throw sentinel
    return 1
  })
  try {kernel.runActiveSearch(owner,100);throw new Error("bridge should throw")}
  catch(error:unknown) {strictEqual(error,sentinel)}
  for(let index=0;index<16;index++) native.step()
  strictEqual(calls,17);deepStrictEqual(nativeFields(owner,names),nativeFields(native,names));assertRipAliases(native,owner)
  const terminal=makePair(1)
  terminal.native.failed=true;terminal.owner.failed=true
  strictEqual(terminal.kernel.runActiveSearch(terminal.owner,100).event,"terminal")
  strictEqual(terminal.checks[1],0)
  const start=makePair(1)
  ;(start.owner as unknown as State).activeConnSeg=null
  strictEqual(start.kernel.runActiveSearch(start.owner,100).event,"cancel")
  strictEqual(start.checks[1],1)
  for(const event of ["goal","budget","empty","cap","start"] as const) {
    const pair=makePair(1000),names=Object.keys(pair.native),flag=new Int32Array(new SharedArrayBuffer(4))
    for(const solver of [pair.native,pair.owner]) {
      setSingleRoot(solver,false,event==="goal")
      const host=solver as unknown as State
      if(event==="budget"||event==="empty") host.heap.clear()
      if(event==="budget") host.baseSearchBudgetIters=-1
      if(event==="cap") solver.MAX_ITERATIONS=solver.iterations+1
      if(event==="start") host.activeConnSeg=null
    }
    let atomicLoads=0
    const eventKernel=new NativeA01HistoryBulkSearchKernel(pair.owner,():number=>{
      atomicLoads++
      return Atomics.load(flag,0)===0?1:0
    })
    strictEqual(Atomics.load(flag,0),0)
    const result=eventKernel.runActiveSearch(pair.owner,100)
    strictEqual(result.event,event);strictEqual(result.consumed,0);strictEqual(result.cancellationChecked,true)
    // The original load authorized this attempt. A later cancellation applies
    // to the next attempt, not to this already-checked native event.
    Atomics.store(flag,0,1)
    pair.native.step();pair.owner.step()
    deepStrictEqual(nativeFields(pair.owner,names),nativeFields(pair.native,names));strictEqual(atomicLoads,1)
    const next=eventKernel.runActiveSearch(pair.owner,100)
    strictEqual(next.event,pair.owner.solved||pair.owner.failed?"terminal":"cancel")
    strictEqual(atomicLoads,pair.owner.solved||pair.owner.failed?1:2)
  }
  expect(cases).toBe(45)
  expect(pureSteps).toBeGreaterThan(100)
})
