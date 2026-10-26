import {AutoroutingPipelineSolver9_PreloadedTraceGraph} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type {SimpleRouteJson} from "lib/types"

export function createConstructionGraphControl():SimpleRouteJson {
  return {
    layerCount:4,minTraceWidth:0.1,minViaPadDiameter:0.5,minViaHoleDiameter:0.3,allowBlindAndBuriedVias:false,
    bounds:{minX:-6,maxX:6,minY:-5,maxY:5},
    obstacles:[
      ...[-4,4].map(x=>({type:"rect" as const,center:{x,y:0},width:0.5,height:0.5,layers:["top"],connectedTo:["signal"],circuitJsonMetadata:{pcb_port_id:x<0?"left":"right"}})),
      {type:"rect",center:{x:0,y:0},width:2,height:3,layers:["top","inner1","inner2","bottom"],connectedTo:["wall"]},
    ],
    connections:[{name:"signal",pointsToConnect:[{x:-4,y:0,layer:"top",pcb_port_id:"left"},{x:4,y:0,layer:"top",pcb_port_id:"right"}]}],
  }
}

export function createPreloadedConstructionGraphControl():SimpleRouteJson {
  const fixed=createConstructionGraphControl()
  fixed.connections=[{name:"fixed",pointsToConnect:[{x:-4,y:-3,layer:"top",pcb_port_id:"fixed-left"},{x:4,y:-3,layer:"top",pcb_port_id:"fixed-right"}]}]
  fixed.obstacles=fixed.obstacles.map((o,i)=>i<2?{...o,center:{...o.center,y:-3},connectedTo:["fixed"],circuitJsonMetadata:{pcb_port_id:i===0?"fixed-left":"fixed-right"}}:o)
  const solver=new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixed,{cacheProvider:null})
  solver.solve()
  if(!solver.solved||solver.failed)throw Error(solver.error??"Native preload control failed")
  const input=createConstructionGraphControl()
  return {...input,connections:[...input.connections,...fixed.connections],obstacles:[...input.obstacles,...fixed.obstacles.slice(0,2)],traces:solver.getOutputSimplifiedPcbTraces()}
}
