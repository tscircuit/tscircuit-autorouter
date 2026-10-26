import {expect,test} from "bun:test"
import {AutoroutingPipelineSolver9_PreloadedTraceGraph} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {evaluateRelaxedDrc} from "lib/testing/evaluate-relaxed-drc"
import {createConstructionGraphControl} from "../fixtures/createConstructionGraphControl"

test("opt-in consumed graph construction preserves native copper and releases completed construction state",():void=>{
  const input=createConstructionGraphControl(),before=JSON.stringify(input)
  const normal=new AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null}),compact=new AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null,releaseGraphConstructionState:true} as any)
  normal.solve();compact.solve()
  expect(normal.solved).toBe(true);expect(compact.solved).toBe(true)
  expect(compact.failed).toBe(false)
  const traces=compact.getOutputSimplifiedPcbTraces()
  expect(traces).toEqual(normal.getOutputSimplifiedPcbTraces())
  expect(evaluateRelaxedDrc({inputSrj:input,srjWithPointPairs:compact.srjWithPointPairs!,routedTraces:traces}).errors).toEqual([])
  expect(JSON.stringify(input)).toBe(before)
  expect(normal.availableSegmentPointSolver).toBeDefined()
  expect(compact.availableSegmentPointSolver).toBeUndefined()
  expect(compact.necessaryCrampedPortPointSolver).toBeUndefined()
  expect(compact.preloadedTraceGraphSolver).toBeUndefined()
  expect(compact.capacityEdges).toBeNull()
  expect(compact.sharedEdgeSegmentsWithNecessaryCrampedPortPoints).toBeUndefined()
  expect(compact.portPointPathingSolver).toBeDefined()
})
