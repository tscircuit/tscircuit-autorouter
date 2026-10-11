import { deepStrictEqual, strictEqual } from "node:assert"
import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01BulkSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-bulk-search/NativeA01BulkSearchKernel"
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
function nativeFields(solver:HighDensitySolverA01, names:readonly string[]):object {
  const fields:Record<string,unknown>={}, descriptors=Object.getOwnPropertyDescriptors(solver)
  for(let index=0;index<names.length;index++) {
    fields[names[index]!]=descriptors[names[index]!]!.value
  }
  return fields
}
function makePair():{native:HighDensitySolverA01; owner:HighDensitySolverA01; kernel:NativeA01BulkSearchKernel} {
  const params={nodeWithPortPoints:structuredClone(cmn45) as NodeWithPortPoints,cellSizeMm:.1,
    viaDiameter:.3,traceThickness:.1,viaMinDistFromBorder:.15,traceMargin:.1,effort:1,
    hyperParameters:{shuffleSeed:0}}
  const native=new HighDensitySolverA01(structuredClone(params)), owner=new HighDensitySolverA01(structuredClone(params))
  native.setup();owner.setup();native.step();owner.step()
  return {native,owner,kernel:new NativeA01BulkSearchKernel(owner)}
}
function setSingleRoot(solver:HighDensitySolverA01, visited:boolean, atGoal:boolean):void {
  const host=solver as unknown as State, goal=host.activeConnSeg!
  const row:Row={z:atGoal?goal.endZ:0,row:atGoal?goal.endRow:Math.floor(solver.rows/2),
    col:atGoal?goal.endCol:Math.floor(solver.cols/2),g:0,f:0,parentIdx:-1,ripped:null}
  host.nodePool=[row];host.heap.clear();host.heap.push(0,host.seqCounter++,0)
  host.visitedStamp.fill(0)
  if(visited) host.visitedStamp[(row.z*solver.rows+row.row)*solver.cols+row.col]=host.stamp
}
function assertRipAliases(native:HighDensitySolverA01, owner:HighDensitySolverA01):void {
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

test("bulk A01 preserves native event order, IEEE costs, retained scratch and shared rip tails", ():void => {
  let cases=0,consumed=0
  for(const kind of ["goal","visited-goal","budget-empty","empty","cap","visited-scratch","rejected-rip","overflow","nan","zero"] as const) {
    const {native,owner,kernel}=makePair(), names=Object.keys(native)
    for(const solver of [native,owner]) {
      const host=solver as unknown as State
      setSingleRoot(solver,kind==="visited-goal"||kind==="visited-scratch",kind==="goal"||kind==="visited-goal")
      const active=host.activeConnId, other=(active+1)%host.connIdToRootNet.length
      host.usedCellsFlat.fill(-1);host.usedDiagFlat.fill(-1);host.portOwnerFlat.fill(-1)
      host._viaOccs.splice(0,host._viaOccs.length,other)
      host._moveCost=-0;host._moveRipped={id:other,prev:null}
      if(kind==="budget-empty"||kind==="empty") host.heap.clear()
      if(kind==="budget-empty") host.baseSearchBudgetIters=-1
      if(kind==="cap") solver.MAX_ITERATIONS=solver.iterations+1
      if(kind==="rejected-rip") {
        const tail:Rip={id:active,prev:null}
        host.nodePool[0]!.ripped=tail
        host.usedCellsFlat.fill(other);host.usedDiagFlat.fill(other)
      }
      if(kind==="overflow") {
        solver.hyperParameters.viaBaseCost=Number.MAX_VALUE
        solver.hyperParameters.ripCost=Number.MAX_VALUE
        solver.hyperParameters.greedyMultiplier=0
        host.ripHistoryCostMultiplier=Number.MAX_VALUE;host.ripCount.fill(100)
        host.usedCellsFlat.fill(other);host.penalty2d.fill(Number.MAX_VALUE)
      }
      if(kind==="nan") {
        solver.hyperParameters.greedyMultiplier=NaN;host.penaltyCap=NaN
        host.penalty2d.fill(Infinity);host.nodePool[0]!.g=NaN
      }
      if(kind==="zero") {
        solver.hyperParameters.viaBaseCost=-0;solver.hyperParameters.ripCost=-0
        solver.hyperParameters.greedyMultiplier=-0;host.penaltyCap=-0;host.penalty2d.fill(0)
        host.nodePool[0]!.g=-0
      }
    }
    const host=owner as unknown as State, oldScratch=host._moveRipped, oldVia=host._viaOccs,
      oldCache=host.viaOccupantsByCell, oldTail=host.nodePool[0]!.ripped
    const result=kernel.runActiveSearch(owner,kind==="visited-scratch"?1:17)
    for(let index=0;index<result.consumed;index++) native.step()
    deepStrictEqual(nativeFields(owner,names),nativeFields(native,names));assertRipAliases(native,owner)
    strictEqual(host._viaOccs,oldVia);strictEqual(host.viaOccupantsByCell,oldCache)
    if(kind==="visited-scratch"||result.consumed===0) strictEqual(host._moveRipped,oldScratch)
    if(kind==="rejected-rip") {
      let tail=host._moveRipped
      while(tail && tail.prev) tail=tail.prev
      strictEqual(tail,oldTail)
    }
    if(result.event!=="limit") {
      native.step();owner.step()
      deepStrictEqual(nativeFields(owner,names),nativeFields(native,names))
    }
    if(kind==="budget-empty") expect(result.event).toBe("budget")
    if(kind==="visited-goal") expect(result.consumed).toBe(1)
    if(kind==="goal") expect(result.event).toBe("goal")
    if(kind==="cap") expect(result.event).toBe("cap")
    consumed+=result.consumed;cases++
  }
  let seed=0x37fa815d
  for(let trial=0;trial<180;trial++) {
    const {native,owner,kernel}=makePair(),names=Object.keys(native)
    seed=(Math.imul(seed,1664525)+1013904223)>>>0
    const bits=seed,policy=[0,-0,.1,-.2,Number.MAX_VALUE,Infinity,NaN][trial%7]!
    for(const solver of [native,owner]) {
      const host=solver as unknown as State
      setSingleRoot(solver,false,false)
      host.usedCellsFlat.fill(-1);host.usedDiagFlat.fill(-1);host.portOwnerFlat.fill(-1)
      for(let index=0;index<host.usedCellsFlat.length;index++) {
        if(((index*193+bits)>>>0)%11===0) host.usedCellsFlat[index]=(index+1)%host.connIdToRootNet.length
        if(((index*317+bits)>>>0)%37===0) host.portOwnerFlat[index]=(index+2)%host.connIdToRootNet.length
      }
      for(let index=0;index<host.usedDiagFlat.length;index++) if(((index*83+bits)>>>0)%17===0) {
        host.usedDiagFlat[index]=(index+3)%host.connIdToRootNet.length
      }
      solver.hyperParameters.greedyMultiplier=policy
      solver.hyperParameters.ripCost=trial%3===0?policy:.1
      host.penaltyCap=trial%5===0?policy:10;host.penalty2d.fill(trial%4===0?policy:.2)
      if(trial%2===0) {
        host.connIdToRootNet.fill("same-root");host.overlapFriendlyRootNets.add("same-root")
      }
      host.viaOccupantsByCell.set(0,[])
      if(trial%4===0) host.viaOccupantsByCell.set(Math.floor(host.planeSize/2),[0,1])
    }
    if(trial===0) (kernel as unknown as {meta:Float64Array}).meta[15]=0xffffffff
    const result=kernel.runActiveSearch(owner,1+bits%100)
    for(let index=0;index<result.consumed;index++) native.step()
    deepStrictEqual(nativeFields(owner,names),nativeFields(native,names));assertRipAliases(native,owner)
    if(result.event!=="limit") {
      native.step();owner.step();deepStrictEqual(nativeFields(owner,names),nativeFields(native,names))
    }
    consumed+=result.consumed;cases++
  }
  expect(cases).toBe(190)
  expect(consumed).toBeGreaterThan(1000)
})
