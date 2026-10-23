import { test, expect } from "bun:test"
import { LegalViaRegionIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/createDeferredViaRegionSearch"
test("a continuous full-stack legal region is certified once across layer pairs", () => {
 const stats={experimentalViaRetainedCells:0,experimentalViaCellVisits:0,experimentalViaCellClassifications:0,experimentalViaCertifiedCells:0,experimentalViaBlockedCells:0,experimentalViaCellSplits:0}
 let queries=0
 const index=new LegalViaRegionIndex({bounds:{minX:-5,maxX:5,minY:-5,maxY:5},resolution:0.1,through:true,stats,classify:()=>{queries++;return 1}})
 const a=index.locate({x:-4,y:2,z:0},3),b=index.locate({x:3,y:-2,z:1},2)
 expect(a).toBe(b);expect(queries).toBe(1);expect(stats.experimentalViaCertifiedCells).toBe(1)
})
