import assert from "node:assert/strict"
import { routeBus as routeBefore } from "/workspace/fanout-plane-layout-fix-2422/lib/route-bus"
import { routeBus as routeAfter } from "/workspace/fanout-plane-static-candidate-2425/lib/route-bus"
import { createIcepiPlaneDrop } from "/workspace/fanout-plane-static-candidate-2425/tests/fixtures/icepi-plane-drop"
import type { FanoutRoutePlan } from "/workspace/fanout-plane-static-candidate-2425/lib/types"

function replay(route: typeof routeAfter) {
  const params = createIcepiPlaneDrop()
  const staticClearanceCache = new Map<string, boolean>()
  let sourcePortReads = 0
  const sourcePoint = params.bus.connections[0]!.sourcePoint
  const portId = sourcePoint.pcb_port_id
  const countedSourcePoint = { ...sourcePoint }
  Object.defineProperty(countedSourcePoint, "pcb_port_id", {
    get() { sourcePortReads++; return portId }, enumerable: true,
  })
  const bus = { ...params.bus, connections: params.bus.connections.map((connection,index)=>index===0 ? {...connection,sourcePoint:countedSourcePoint}:connection) }
  const input = { ...params, bus, staticClearanceCache }
  const cold = route(input)
  sourcePortReads = 0
  const warm = route(input)
  const warmSourcePortReads = sourcePortReads
  assert.deepStrictEqual(warm,cold)
  assert(cold?.length===1)
  const original = cold[0]!
  const blocker: FanoutRoutePlan = {
    ...original, busId: "blocker", connectionIndex: -1, connectionName: "blocker",
    sourcePoint: {x:999,y:999,layer:"top"},
  }
  const blocked = route({...input, acceptedPlans:[blocker]})
  assert.deepStrictEqual(route(input),cold)
  return {
    cold: JSON.stringify(cold), warm: JSON.stringify(warm), blocked: JSON.stringify(blocked),
    warmSourcePortReads,
    cachedStaticRejections:[...staticClearanceCache.values()].filter(result=>result===false).length,
    cachedStaticAcceptances:[...staticClearanceCache.values()].filter(result=>result===true).length,
  }
}
const before=replay(routeBefore),after=replay(routeAfter)
assert.equal(after.cold,before.cold)
assert.equal(after.warm,before.warm)
assert.equal(after.blocked,before.blocked)
console.log(JSON.stringify({before:{...before,cold:undefined,warm:undefined,blocked:undefined},after:{...after,cold:undefined,warm:undefined,blocked:undefined},allOutputObjectsMatch:true},null,2))
