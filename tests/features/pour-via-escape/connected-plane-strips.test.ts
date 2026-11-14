import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { getConnectedCopperPourRepresentatives } from "../../../lib/solvers/EscapeViaLocationSolver/getConnectedCopperPourRepresentatives"
import { NetToPointPairsSolver } from "../../../lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { Obstacle, SimpleRouteJson } from "../../../lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "../../../lib/utils/get-initially-connected-map-from-simple-route-json"

test("plane escapes share transitive touching strips while gaps, other nets and layers remain separate", (): void => {
  const points = [{x:-3,y:-1.3,layer:"top",pointId:"left-pad"},{x:3,y:1.3,layer:"top",pointId:"right-pad"}]
  const strips: Obstacle[] = Array.from({length:9},(_,index)=>({
    obstacleId:`strip-${index}`,type:"rect",center:{x:0,y:-2+index*0.5},
    width:12,height:0.5,layers:["inner1"],connectedTo:["GND"],isCopperPour:true,
  }))
  for (const variant of ["touching","gap","other_net","other_layer"] as const) {
    const pours = strips.flatMap((strip,index): Obstacle[] => {
      if(index!==4)return [strip]
      if(variant==="gap")return []
      if(variant==="other_net")return [{...strip,connectedTo:["VCC"]}]
      if(variant==="other_layer")return [{...strip,layers:["inner2"]}]
      return [strip]
    })
    const input: SimpleRouteJson = {
      layerCount:4,minTraceWidth:0.1,minViaPadDiameter:0.4,minViaHoleDiameter:0.2,
      defaultObstacleMargin:0.1,bounds:{minX:-7,maxX:7,minY:-3,maxY:3},
      obstacles:[...pours,...points.map((point): Obstacle => ({
        obstacleId:point.pointId,type:"rect",center:{x:point.x,y:point.y},
        width:0.5,height:0.5,layers:["top"],connectedTo:["GND",point.pointId],
      }))],connections:[{name:"GND",pointsToConnect:points}],
    }
    const original=structuredClone(input)
    const escape=new EscapeViaLocationSolver(input)
    escape.solve()
    expect(input).toEqual(original)
    expect(escape.failed).toBe(false)
    expect(escape.createdEscapeVias).toHaveLength(2)
    const output=escape.getOutputSimpleRouteJson()
    const pairs=new NetToPointPairsSolver(output,{},getInitiallyConnectedMapFromSimpleRouteJson(output))
    pairs.solve()
    expect(pairs.failed).toBe(false)
    expect(pairs.newConnections).toHaveLength(variant==="touching"?2:3)
    if(variant==="touching") {
      expect(output.connections[0].externallyConnectedPointIds).toHaveLength(1)
      expect(output.connections[0].externallyConnectedPointIds![0]).toHaveLength(2)
      for(const pair of pairs.newConnections) {
        expect(pair.pointsToConnect.some((point)=>point.pointId?.startsWith("escape-via:"))).toBe(true)
        expect(pair.pointsToConnect.some((point)=>point.pointId?.endsWith("-pad"))).toBe(true)
      }
    } else expect(output.connections[0].externallyConnectedPointIds ?? []).toEqual([])
  }
  const first=strips[0]
  const corner={...first,center:{x:12,y:-1.5}}
  const tinyGap={...first,center:{x:0,y:-1.499999}}
  expect(getConnectedCopperPourRepresentatives([first,corner]).get(corner)).toBe(corner)
  expect(getConnectedCopperPourRepresentatives([first,tinyGap]).get(tinyGap)).toBe(tinyGap)
  const rotated={...first,center:{x:0,y:0},width:4,height:0.2,ccwRotationDegrees:45}
  const apart={...rotated,center:{x:0,y:1}}
  const touching={...rotated,center:{x:-0.2/Math.sqrt(2),y:0.2/Math.sqrt(2)}}
  expect(getConnectedCopperPourRepresentatives([rotated,apart]).get(apart)).toBe(apart)
  expect(getConnectedCopperPourRepresentatives([rotated,touching]).get(touching)).toBe(rotated)
})
