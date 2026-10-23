import { test, expect } from "bun:test"
import { doInteractionRoutesConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
test("interaction oracle expands through-via copper and checks disjoint blind drills", () => {
 const via:HighDensityRoute={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:0,y:0,z:0},{x:0,y:0,z:1}],vias:[{x:0,y:0}]}
 const wire:HighDensityRoute={connectionName:"b",traceThickness:0.1,viaDiameter:0.3,route:[{x:-1,y:0,z:2},{x:1,y:0,z:2}],vias:[]}
 const stats={experimentalInteractionCopperPrimitiveTests:0}
 expect(doInteractionRoutesConflict({left:via,right:wire,sameNet:false,clearance:0.1,layerCount:4,stats})).toBe(true)
 expect(doInteractionRoutesConflict({left:via,right:wire,sameNet:false,clearance:0.1,layerCount:4,allowBlindAndBuriedVias:true,stats})).toBe(false)
 const other:HighDensityRoute={...via,route:[{x:0.1,y:0,z:2},{x:0.1,y:0,z:3}],vias:[{x:0.1,y:0}]}
 expect(doInteractionRoutesConflict({left:via,right:other,sameNet:true,clearance:0.1,layerCount:4,allowBlindAndBuriedVias:true,stats})).toBe(true)
 expect(stats.experimentalInteractionCopperPrimitiveTests).toBeGreaterThan(0)
})
