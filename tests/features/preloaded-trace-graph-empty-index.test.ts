import {expect,test} from "bun:test"
import {PreloadedTraceGraphSolver} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
test("preload accepts an empty capacity-boundary graph",()=>{
  const solver=new PreloadedTraceGraphSolver([],{layerCount:2,minTraceWidth:.1,bounds:{minX:-1,maxX:1,minY:-1,maxY:1},obstacles:[],connections:[],traces:[]})
  solver.solve()
  expect(solver.getOutput()).toEqual([])
  expect(solver.stats).toMatchObject({inputBoundaryCount:0,outputBoundaryCount:0,tracePortAssignmentCount:0,topologyChanged:false})
})
