import {expect,test} from "bun:test"
import {AutoroutingPipelineSolver9_PreloadedTraceGraph} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {evaluateRelaxedDrc} from "lib/testing/evaluate-relaxed-drc"
import {createPreloadedConstructionGraphControl} from "../fixtures/createConstructionGraphControl"

test("consumed construction preserves native routing with preloaded copper",():void=>{
 const input=createPreloadedConstructionGraphControl(),before=JSON.stringify(input)
 const normal=new AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null}),compact=new AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null,releaseGraphConstructionState:true})
 normal.solve();compact.solve()
 expect(normal.solved).toBe(true);expect(compact.solved).toBe(true)
 expect(compact.getOutputSimplifiedPcbTraces()).toEqual(normal.getOutputSimplifiedPcbTraces())
 expect(compact.getUpdatedPreloadedTraces()).toEqual(normal.getUpdatedPreloadedTraces())
 expect(JSON.stringify(input)).toBe(before)
 expect(evaluateRelaxedDrc({inputSrj:input,srjWithPointPairs:compact.srjWithPointPairs!,routedTraces:compact.getOutputSimplifiedPcbTraces()}).errors).toEqual([])
 expect(compact.availableSegmentPointSolver).toBeUndefined()
})
