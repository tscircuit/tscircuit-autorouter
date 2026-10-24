import { strict as assert } from "node:assert"
import { test } from "bun:test"
import { NegotiateTraceClearanceSolver as Native, type NegotiatedClearanceInput, type ClearancePathSearchStats } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver as Persistent } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairScene/NegotiateTraceClearanceSolver"
test("persistent scene preserves native own-net drill, disjoint blind spans, widths and through-obstacle policy", (): void => {
for(const blind of [false,true])for(const viaGap of [0.1,0.35]){
 const bounds={minX:-1.3,maxX:1.3,minY:-1.3,maxY:1.3}
 const routes:NegotiatedClearanceInput['routes']=[
 {connectionName:'horizontal',rootConnectionName:'same',traceThickness:0.1,viaDiameter:0.3,route:[{x:-1,y:0,z:0},{x:1,y:0,z:0}],vias:[]},
 {connectionName:'vertical',rootConnectionName:'other',traceThickness:0.1,viaDiameter:0.3,route:[{x:0,y:-1,z:0},{x:0,y:1,z:0}],vias:[]},
 {connectionName:'same-net-blind-a',rootConnectionName:'same',traceThickness:0.1,viaDiameter:0.3,route:[{x:-0.45,y:0.4,z:0},{x:-0.45,y:0.4,z:1}],vias:[{x:-0.45,y:0.4}]},
 {connectionName:'same-net-blind-b',rootConnectionName:'same',traceThickness:0.1,viaDiameter:0.3,route:[{x:-0.32,y:0.4,z:2},{x:-0.32,y:0.4,z:3}],vias:[{x:-0.32,y:0.4}]},
 {connectionName:'through',rootConnectionName:'foreign-through',traceThickness:0.2,viaDiameter:0.3,route:[{x:-1,y:-0.6,z:0,toNextSegmentType:'through_obstacle'},{x:1,y:-0.6,z:0}],vias:[]},
 {connectionName:'same-planar-variable-width',rootConnectionName:'same',traceThickness:0.1,viaDiameter:0.3,route:[{x:-1,y:0.1,z:0},Object.assign({x:0,y:0.1,z:0},{traceThickness:0.15}),{x:1,y:0.1,z:0}],vias:[]},
 ]
 const input:NegotiatedClearanceInput={srj:{layerCount:4,allowBlindAndBuriedVias:blind,minTraceWidth:0.1,bounds,obstacles:[],connections:routes.map(r=>({name:r.connectionName,rootConnectionName:r.rootConnectionName,pointsToConnect:r.route.map(p=>({x:p.x,y:p.y,layer:'top'}))}))},routes,bounds,dirtyRouteIndices:[0,1,2,3,5],isLocked:(ri):boolean=>ri===4,allowLayerChanges:true,traceClearance:0.1,viaClearance:viaGap,viaHoleDiameter:0.15,maxPathSearchNodes:16000,maxPathSearchNodesPerCall:2000,maxPathSearchCalls:16,pathHeuristicWeight:3}
 const calls:ClearancePathSearchStats[][]=[[],[]]
 const n=new Native({...structuredClone({...input,isLocked:undefined}),isLocked:input.isLocked,onSearch:s=>calls[0]!.push({...s})})
 const p=new Persistent({...structuredClone({...input,isLocked:undefined}),isLocked:input.isLocked,onSearch:s=>calls[1]!.push({...s})},blind)
 while(!n.solved&&!n.failed){n.step();p.step();assert.equal(p.iterations,n.iterations);assert.deepEqual(p.stats,n.stats);assert.equal(p.solved,n.solved);assert.equal(p.failed,n.failed)}
 assert.deepEqual(p.getOutput(),n.getOutput());assert.deepEqual(calls[1],calls[0])
 if(!blind) { assert.equal(p.diagnostics.candidateQueries,0); assert.equal(p.diagnostics.nativeDistanceEvaluations,0) }
 const output=p.getOutput();const through=output.routes.find(r=>r.connectionName==='through')!
 assert.equal(through.route[0]!.toNextSegmentType,'through_obstacle')
}
})
