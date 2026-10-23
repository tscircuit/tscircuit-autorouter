import { test, expect } from "bun:test"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/FindClearancePathSolver"
test("continuous region realizes a legal transition absent from sampled grid sites", () => {
 const route={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:-1,y:0,z:0},{x:0.83,y:0.17,z:1}],vias:[]}
 const srj={layerCount:2,minTraceWidth:0.1,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},connections:[],obstacles:[]}
 const end=route.route[1]!
 const solver=new FindClearancePathSolver({srj,routes:[route],routeIndex:0,start:route.route[0]!,end,bounds:srj.bounds,traceThickness:0.1,traceClearance:0.1,viaClearance:0.1,gridSize:0.2,maxNodes:30000,getAdditionalEdgeCost:(a,b)=>a.z!==b.z&&Math.hypot(a.x-end.x,a.y-end.y)>1e-8?Infinity:0})
 solver.solve();expect(solver.failed).toBe(false);const path=solver.getOutput();expect(path).not.toBeNull()
 const vias=path!.filter((p,i)=>i>0&&p.z!==path![i-1]!.z)
 expect(vias).toHaveLength(1);expect(vias[0]!.x).toBe(end.x);expect(vias[0]!.y).toBe(end.y)
 expect(solver.stats.experimentalViaCertifiedWitnessUses).toBeGreaterThan(0)
})
