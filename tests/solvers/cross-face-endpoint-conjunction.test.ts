import { expect, test } from "bun:test"
import {
  getCrossFaceEndpointFeasibility,
  type EndpointDomainEvent,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getCrossFaceEndpointFeasibility"

test("joint endpoint domains preserve alternatives and reject the actual thin-strip conjunction", (): void => {
  const x = 193.25958363499996,
    y = 47.16780254000001
  const width = 0.37731636500001287,
    height = 0.045996459999983585
  const events: EndpointDomainEvent[] = [
    {
      portId: 4,
      faceKey: "horizontal276",
      owner: "276",
      z: 7,
      bounds: { minX: x, maxX: x + width, minY: y, maxY: y },
      routeIds: [],
      candidate: true,
    },
    {
      portId: 3,
      faceKey: "left108",
      owner: "108",
      z: 7,
      bounds: { minX: x, maxX: x, minY: y, maxY: y + height },
      routeIds: [1871],
      candidate: false,
    },
    {
      portId: 5,
      faceKey: "right108",
      owner: "108",
      z: 7,
      bounds: { minX: x + width, maxX: x + width, minY: y, maxY: y + height },
      routeIds: [1871],
      candidate: false,
    },
  ]
  const input = { events, minimumSpacing: 0.195, slack: 1e-8 }
  const snapshot = structuredClone(input)
  expect(getCrossFaceEndpointFeasibility(input)).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1871]] })
  expect(getCrossFaceEndpointFeasibility({ ...input, events: events.slice(0,2) })).toEqual({ feasible: true })
  expect(getCrossFaceEndpointFeasibility({ ...input, events: [events[0]!,events[2]!] })).toEqual({ feasible: true })
  const alias = events.map((event, index) => index === 0 ? event : { ...event, routeIds: [1871, 1999] })
  expect(getCrossFaceEndpointFeasibility({ ...input, events: alias })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1871,1999]] })
  const independent = events.map((event, index) => index === 0 ? event : { ...event, routeIds: index===1 ? [1,2] : [3] })
  expect(getCrossFaceEndpointFeasibility({ ...input, events: independent })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1,2],[3]] })
  const reversed = events.map((event, index) => ({ ...event, candidate: index !== 0, routeIds: index===0 ? [1573] : [] }))
  expect(getCrossFaceEndpointFeasibility({ ...input, events: reversed })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1573]] })
  const taller = events.map((event, index) => index===0 ? event : { ...event, bounds: { ...event.bounds, maxY: y+.1 } })
  expect(getCrossFaceEndpointFeasibility({ ...input, events: taller })).toEqual({ feasible: true })
  const tangentWidth = 2*Math.sqrt(.195**2-height**2)
  const tangent = events.map((event, index) => ({ ...event, bounds: index===0 ? { ...event.bounds, maxX: x+tangentWidth } : index===2 ? { ...event.bounds, minX:x+tangentWidth,maxX:x+tangentWidth } : event.bounds }))
  expect(getCrossFaceEndpointFeasibility({ ...input, events: tangent })).toEqual({ feasible: true })
  const unrelated = events.map((event,index)=>({ ...event,candidate:false,routeIds:[index+10] }))
  unrelated.push({ ...events[0]!, portId:99,faceKey:"unrelated",owner:"other",bounds:{minX:x+10,maxX:x+11,minY:y,maxY:y},candidate:true,routeIds:[] })
  expect(getCrossFaceEndpointFeasibility({ ...input,events:unrelated })).toEqual({ feasible:true })
  const huge = events.map((event, index) => ({ ...event, bounds: index===0
    ? { minX:0,maxX:2e200,minY:0,maxY:0 }
    : { minX:0,maxX:0,minY:0,maxY:0 } }))
  expect(getCrossFaceEndpointFeasibility({ ...input,events:huge,minimumSpacing:1e200 })).toEqual({ feasible:true })
  expect(input).toEqual(snapshot)
  for (let trial=0;trial<200;trial++) {
    const count = 3+trial%4
    const legal: EndpointDomainEvent[] = Array.from({length:count},(_,index)=>{
      const angle = 2*Math.PI*index/count
      const px = 50+.4*Math.cos(angle), py=70+.4*Math.sin(angle)
      const expansion=.01+(trial%17)/20
      return {portId:index,faceKey:`face${index}`,owner:`owner${index}`,z:0,candidate:index===0,routeIds:index===0?[]:[index],bounds:{minX:px-expansion,maxX:px+expansion,minY:py-expansion,maxY:py+expansion}}
    })
    expect(getCrossFaceEndpointFeasibility({ ...input,events:legal })).toEqual({feasible:true})
  }
})
