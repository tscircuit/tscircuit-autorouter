import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GlobalDrcForceImproveSolverParams } from "high-density-repair03/lib"
import { GlobalDrcForceImproveSolver } from "../../../lib/bindings/repair/GlobalDrcForceImproveSolver"
import { importReference } from "./tsReference"
const { GlobalDrcForceImproveSolver: ReferenceSolver } = await importReference<typeof import("high-density-repair03/lib")>("node_modules/high-density-repair03/lib/index.ts")
const file=process.argv[2]
if(!file)throw new Error("Provide a captured GlobalDrcForceImproveSolver params JSON path")
function input():GlobalDrcForceImproveSolverParams {
  const params=JSON.parse(readFileSync(file!,"utf8"),(_key,value)=>{
    if(value?.$map)return new Map(value.$map)
    if(value?.$set)return new Set(value.$set)
    return value
  }) as GlobalDrcForceImproveSolverParams
  if(params.connMap)params.connMap=Object.assign(new ConnectivityMap({}),params.connMap)
  return params
}
function same(actual:unknown,expected:unknown,label:string):void {
  const a=JSON.stringify(actual),b=JSON.stringify(expected)
  if(a===b)return
  writeFileSync(file+".actual.json",a);writeFileSync(file+".expected.json",b)
  let offset=0;while(offset<Math.min(a.length,b.length)&&a[offset]===b[offset])offset++
  throw new Error(`${label} first byte ${offset}\nActual ${a.slice(Math.max(0,offset-80),offset+200)}\nExpected ${b.slice(Math.max(0,offset-80),offset+200)}`)
}
function state(solver:InstanceType<typeof ReferenceSolver>):unknown {
  return {solved:solver.solved,failed:solver.failed,error:solver.error,iterations:solver.iterations,MAX_ITERATIONS:solver.MAX_ITERATIONS,progress:solver.progress,stats:solver.stats}
}
const expected=new ReferenceSolver(input()),actual=new GlobalDrcForceImproveSolver(input())
same(state(actual),state(expected),"Constructor")
let steps=0
while(!expected.solved&&!expected.failed) {
  if(++steps>100)throw new Error("Captured fixture exceeded 100 outer steps")
  const priorExpected=expected.getOutput(),priorActual=actual.getOutput()
  expected.step();actual.step()
  same(state(actual),state(expected),`Step ${steps} state`)
  const wanted=expected.getOutput(),result=actual.getOutput()
  same(result,wanted,`Step ${steps} routes`)
  assert.equal(result===priorActual,wanted===priorExpected,`Step ${steps} output identity`)
  for(let index=0;index<result.length;index++)assert.equal(result[index]===priorActual[index],wanted[index]===priorExpected[index],`Step ${steps} route ${index} identity`)
  console.log(`Step ${steps}: state, routes and identities identical`)
}
console.log(`Captured standalone stage identical: ${steps} steps, ${actual.getOutput().length} routes`)
