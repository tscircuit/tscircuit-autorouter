import { deepStrictEqual } from "node:assert"
import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { NativeA01BulkSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-bulk-search/NativeA01BulkSearchKernel"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

function nativeFields(solver:HighDensitySolverA01, names:readonly string[]):object {
  const fields:Record<string,unknown>={}, descriptors=Object.getOwnPropertyDescriptors(solver)
  for(let index=0;index<names.length;index++) {
    fields[names[index]!]=descriptors[names[index]!]!.value
  }
  return fields
}
function createGrid(rows:number,cols:number,z:number[]):HighDensitySolverA01 {
  const width=cols*.1+.001,height=rows*.1+.001
  const node:NodeWithPortPoints={capacityMeshNodeId:"bulk-layout",center:{x:0,y:0},width,height,availableZ:z,
    portPoints:[{x:-width/2,y:-height/2,z:z[0]!,connectionName:"wire"},
      {x:width/2,y:height/2,z:z[z.length-1]!,connectionName:"wire"}]}
  const solver=new HighDensitySolverA01({nodeWithPortPoints:node,cellSizeMm:.1,viaDiameter:.05,
    traceThickness:.01,traceMargin:0,viaMinDistFromBorder:0,effort:1})
  solver.setup();solver.MAX_ITERATIONS=Math.min(solver.MAX_ITERATIONS,10000)
  return solver
}

test("bulk A01 matches native thin, single-layer and sparse multi-layer grids and rejects malformed layouts before execution", ():void => {
  const shapes:[number,number,number[]][]=[[1,1,[0]],[1,6,[0]],[6,1,[0]],[5,7,[0,1,2]],[3,4,[0,2,7,11]],
    [1,9,[0,5,7]],[8,1,[0,2,4,6]]]
  let batches=0,steps=0
  for(const [rows,cols,layers] of shapes) {
    const native=createGrid(rows,cols,layers),owner=createGrid(rows,cols,layers)
    const kernel=new NativeA01BulkSearchKernel(owner),names=Object.keys(native)
    while(!native.solved&&!native.failed) {
      const result=kernel.runActiveSearch(owner,100)
      for(let index=0;index<result.consumed;index++) native.step()
      deepStrictEqual(nativeFields(owner,names),nativeFields(native,names))
      if(result.event!=="limit") {
        native.step();owner.step()
        deepStrictEqual(nativeFields(owner,names),nativeFields(native,names))
      }
      batches++
    }
    deepStrictEqual(owner.getOutput(),native.getOutput());steps+=native.iterations
  }
  for(const mutation of ["planeSize","usedDiagFlat","viaOccupantScanOffsetsLen","endRow"] as const) {
    const owner=createGrid(5,7,[0,3,9]),kernel=new NativeA01BulkSearchKernel(owner)
    owner.step()
    const host=owner as unknown as Record<string,unknown>
    if(mutation==="usedDiagFlat") host.usedDiagFlat=new Int32Array(1)
    else if(mutation==="endRow") (host.activeConnSeg as {endRow:number}).endRow=5
    else host[mutation]=(host[mutation] as number)+1
    const iterations=owner.iterations
    expect(():void=>{kernel.runActiveSearch(owner,100)}).toThrow()
    expect(owner.iterations).toBe(iterations)
    expect(kernel.diagnostics.batches).toBe(0)
  }
  const zero=createGrid(0,0,[0])
  expect(():void=>{new NativeA01BulkSearchKernel(zero)}).toThrow("bounded kernel domain")
  expect(batches).toBeGreaterThan(7)
  expect(steps).toBeGreaterThan(30)
})
