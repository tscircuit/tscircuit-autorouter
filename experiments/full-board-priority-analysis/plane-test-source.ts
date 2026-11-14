import type { FullBoardSource } from "./native-full-board"

/** All fixture vertices are board-world positions in mm (+X right, +Y up). */
export function createPlaneTestSource(outlines: { x: number; y: number }[][], layer = "inner1"): FullBoardSource {
  return {
    id: "plane-test", title: "Fresh plane connectivity", width: 14, height: 8,
    outline: [{x:-7,y:-4},{x:7,y:-4},{x:7,y:4},{x:-7,y:4}],
    layers: 4, signalLayers: ["top","inner2","bottom"],
    rules: {widths:[0.1],appliedGlobalClearance:0.1,viaPad:0.4,viaDrill:0.2},
    parts: [-3,3].map((x,index) => ({
      name:`U${index+1}`,nativeReference:`U${index+1}`,value:"TEST",footprint:"single_pad",
      x,y:index*2-1,layer:"top",pinLabels:{pin1:["GROUND"]},silkscreen:[],
      pads:[{pin:"pin1",nativePin:"1",kind:"smd",shape:"circle",sourceNet:"GND",
        x:0,y:0,width:0.5,height:0.5,rotation:0,cornerRadius:0}],
    })),
    nets:[{name:"N0000",nativeName:"GND",members:[".U1 > .pin1",".U2 > .pin1"],
      width:0.1,escapeWidth:0.1,clearance:0.1,group:"board",routable:true,isGround:true}],
    planeIntent:{savedCopperImported:false,skippedTeardrops:0,sourceKeepouts:0,
      zones:[{name:"GROUND_PLANE",nativeName:"GND",netName:"N0000",layer,priority:0,clearance:0.1,
        useThermalReliefs:false,unbroken:layer.startsWith("inner"),sourceOutlines:outlines,outlines}]},
  }
}
