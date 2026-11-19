import assert from "node:assert/strict"
import { routeBus as beforeRoute } from "/workspace/fanout-plane-static-candidate-2425/lib/route-bus"
import { routeBus as afterRoute } from "/workspace/fanout-obstacle-broadphase-2426/lib/route-bus"
import { segmentIsClearOfObstacles as before } from "/workspace/fanout-plane-static-candidate-2425/lib/route-bus/plan-static-clearance"
import { segmentIsClearOfObstacles as after } from "/workspace/fanout-obstacle-broadphase-2426/lib/route-bus/plan-static-clearance"
import { createIcepiPlaneDrop } from "/workspace/fanout-obstacle-broadphase-2426/tests/fixtures/icepi-plane-drop"
import type { Obstacle } from "/workspace/fanout-obstacle-broadphase-2426/node_modules/@tscircuit/capacity-autorouter"
import type { RoutedSegment } from "/workspace/fanout-obstacle-broadphase-2426/lib/types"

type ShapeAwareObstacle=Obstacle & {shape?:"circle";ccwRotationDegrees?:number}
const params=createIcepiPlaneDrop()
const plan=beforeRoute(params)?.[0]
assert(plan)
assert.deepStrictEqual(afterRoute(params),beforeRoute(params))
const rules={plan,segmentIndex:-1,srj:params.srj,allowSameNetMerges:false}
let comparisons=0
function compare(segment:RoutedSegment,obstacle:ShapeAwareObstacle,clearance:number){
 const input={...rules,segment,obstacles:[obstacle],clearance}
 assert.equal(after(input),before(input),JSON.stringify({segment,obstacle,clearance}))
 comparisons++
}
const segment={start:{x:-1,y:0},end:{x:1,y:0},width:.1,layer:"top"}
for(const shape of [undefined,"circle"] as const)for(const rotation of [0,45,90,135,179.999,270,359.99])for(const gap of [-.1,-2e-9,-1e-9,0,1e-9,2e-9,.1,10]){
 compare(segment,{type:"rect",center:{x:0,y:.25+gap},width:.2,height:.2,layers:["top"],connectedTo:["foreign"],componentId:"foreign",shape,ccwRotationDegrees:rotation},.1)
}
let seed=0x3132426
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
for(let index=0;index<20_000;index++){
 const scale=[1e-8,1,1000][index%3]!
 const segment:RoutedSegment={start:{x:(random()*10-5)*scale,y:(random()*10-5)*scale},end:{x:(random()*10-5)*scale,y:(random()*10-5)*scale},width:random()*.5*scale,layer:"top"}
 const obstacle:ShapeAwareObstacle={type:"rect",center:{x:(random()*10-5)*scale,y:(random()*10-5)*scale},width:index%11===0?0:random()*3*scale,height:index%13===0?0:random()*3*scale,layers:index%17===0?["bottom"]:["top"],connectedTo:["foreign"],componentId:"foreign",shape:index%2===0?"circle":undefined,ccwRotationDegrees:random()*720-360}
 compare(segment,obstacle,random()*.3*scale)
}
function count(check:typeof after){
 const p=createIcepiPlaneDrop();const plan=beforeRoute(p)![0]!
 let shapeReads=0;let activeObstacle:Obstacle|undefined
 for(const obstacle of p.srj.obstacles){
  const shape=(obstacle as ShapeAwareObstacle).shape
  Object.defineProperty(obstacle,"shape",{get(){if(obstacle===activeObstacle)shapeReads++;return shape},enumerable:true,configurable:true})
 }
 for(const [segmentIndex,segment]of plan.segments.entries())for(const obstacle of p.srj.obstacles){
  activeObstacle=obstacle
  assert(check({segment,plan,segmentIndex,srj:p.srj,allowSameNetMerges:false,obstacles:[obstacle],clearance:p.clearance}))
 }
 activeObstacle=undefined
 return shapeReads
}
console.log(JSON.stringify({comparisonCases:comparisons,exactNativeChecksBefore:count(before),exactNativeChecksAfter:count(after),routeOutputsMatch:true}))
