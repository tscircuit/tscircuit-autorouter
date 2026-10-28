import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

test("both public Pipeline9 outputs reject a via moved into a keepout after routing", () => {
  const solver = new Pipeline({layerCount:2,minTraceWidth:0.15,minViaDiameter:0.6,bounds:{minX:-5,maxX:5,minY:-5,maxY:5},obstacles:[],connections:[{name:"net",pointsToConnect:[{x:-3,y:0,layer:"top"},{x:3,y:0,layer:"bottom"}]}],viaKeepouts:[{shape:"circle",center:{x:0,y:0},radius:0.1,layers:["top"]}]})
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(1)
  const lateOutput = structuredClone(solver.powerTraceExpansionSolver!.getOutput())
  const via = lateOutput.flatMap(t=>t.route).find(p=>p.route_type==="via")!
  expect(via).toBeDefined()
  via.x=0;via.y=0
  // Fault injection at the final mutating-stage boundary, not a claim that
  // power expansion naturally produces this displacement for this fixture.
  solver.powerTraceExpansionSolver!.getOutput = () => lateOutput
  expect(()=>solver.getOutputSimplifiedPcbTraces()).toThrow("Via copper overlaps")
  expect(()=>solver.getOutputSimpleRouteJson()).toThrow("Via copper overlaps")
})
