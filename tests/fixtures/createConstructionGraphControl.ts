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
