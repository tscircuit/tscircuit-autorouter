import { test, expect } from "bun:test"
import { realizeViaCell } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/createDeferredViaRegionSearch"
test("deferred via coordinates reject close prior drills and realize a spaced witness", () => {
 const stats={experimentalViaPackingDomainTests:0,experimentalViaCoordinateWitnesses:0,experimentalViaHistoryTests:0,experimentalViaPackingRejectedWitnesses:0}
 const witnesses=realizeViaCell({cell:{minX:-2,maxX:2,minY:-2,maxY:2,certificate:1},source:{x:0.1,y:0,z:0},target:{x:0.2,y:0,z:1},vias:[{x:0,y:0}],spacing:1,stats})
 expect(stats.experimentalViaPackingRejectedWitnesses).toBeGreaterThan(0)
 expect(witnesses.length).toBeGreaterThan(0)
 for(const p of witnesses)expect(Math.hypot(p.x,p.y)).toBeGreaterThanOrEqual(1-1e-8)
 expect(witnesses.some(p=>p.x>0.9)).toBe(true)
})
