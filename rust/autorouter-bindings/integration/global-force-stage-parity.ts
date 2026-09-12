import assert from "node:assert/strict"
import type { GlobalDrcForceImproveSolverParams, HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"
import { GlobalDrcForceImproveSolver } from "../../../lib/bindings/repair/GlobalDrcForceImproveSolver"
import { importReference } from "./tsReference"

const { GlobalDrcForceImproveSolver: ReferenceSolver } = await importReference<typeof import("high-density-repair03/lib")>("node_modules/high-density-repair03/lib/index.ts")
type Fixture = { name: string; routes: HighDensityRoute[]; obstacles?: SimpleRouteJson["obstacles"] }
function route(name: string, points: Array<[number,number,number]>): HighDensityRoute {
  return { connectionName:name, traceThickness:0.1, viaDiameter:0.3,
    route:points.map(([x,y,z])=>({x,y,z})), vias:[] }
}
function state(solver: InstanceType<typeof ReferenceSolver>): unknown {
  return { solved:solver.solved,failed:solver.failed,error:solver.error,iterations:solver.iterations,
    maxIterations:solver.MAX_ITERATIONS,progress:solver.progress,stats:solver.stats }
}
const fixtures: Fixture[] = [
  { name:"empty", routes:[] },
  { name:"already-clean", routes:[route("a",[[-1,0,0],[1,0,0]]),route("b",[[-1,1,0],[1,1,0]])] },
  { name:"first-versus-worst-contact",routes:[route("a",[[-1,0,0],[0,0,0],[1,0,0]]),route("b",[[-1,0.18,0],[0,0.12,0],[1,0.1,0]])] },
  { name:"via-pad",routes:[route("a",[[-1,0,0],[0,0,0],[0,0,1],[1,0,1]])],obstacles:[{type:"rect",layers:["top"],center:{x:0.2,y:0},width:0.2,height:0.2,connectedTo:["pcb_smtpad_foreign"]}] },
  { name:"crossing",routes:[route("a",[[-1,-1,0],[0,0,0],[1,1,0]]),route("b",[[-1,1,0],[0,0,0],[1,-1,0]])] },
]
for (const fixture of fixtures) {
  const srj:SimpleRouteJson={bounds:{minX:-3,minY:-3,maxX:3,maxY:3},connections:["a","b"].map(name=>({name,pointsToConnect:[]})),obstacles:fixture.obstacles??[],layerCount:2,minTraceWidth:0.1,minViaDiameter:0.3}
  const input:GlobalDrcForceImproveSolverParams={srj,hdRoutes:fixture.routes,maxIterations:2,enableBroadFallback:false,enablePostSolveClearanceRelaxation:false}
  for (const [routeIndex, route] of input.hdRoutes.entries()) {
    for (const [pointIndex, point] of route.route.entries()) Object.assign(point,{ shared:{routeIndex,pointIndex}, optional:undefined })
  }
  const expected=new ReferenceSolver(structuredClone(input))
  const actual=new GlobalDrcForceImproveSolver(structuredClone(input))
  assert.equal(actual.getOutput(),actual.inputHdRoutes)
  assert.equal(actual.getConstructorParams()[0].hdRoutes,actual.inputHdRoutes)
  let priorExpected=expected.getOutput(),priorActual=actual.getOutput()
  assert.equal(JSON.stringify(state(actual)),JSON.stringify(state(expected)),fixture.name+" constructor")
  for(let step=0;step<4 && !expected.solved&&!expected.failed;step++) {
    expected.step();actual.step()
    assert.equal(JSON.stringify(state(actual)),JSON.stringify(state(expected)),`${fixture.name} step${step} state`)
    const wanted=expected.getOutput(),result=actual.getOutput()
    assert.equal(JSON.stringify(result),JSON.stringify(wanted),`${fixture.name} step${step} routes`)
    assert.equal(result===priorActual,wanted===priorExpected,`${fixture.name} output array identity`)
    for(let index=0;index<result.length;index++) assert.equal(result[index]===priorActual[index],wanted[index]===priorExpected[index],`${fixture.name} route${index} identity`)
    for (const [routeIndex, route] of result.entries()) {
      for (const [pointIndex, point] of route.route.entries()) {
        const expectedPoint=wanted[routeIndex]!.route[pointIndex]!
        assert.equal(Object.hasOwn(point,"optional"),Object.hasOwn(expectedPoint,"optional"),`${fixture.name} optional metadata`)
        const original=actual.inputHdRoutes[routeIndex]?.route[pointIndex]
        const expectedOriginal=expected.inputHdRoutes[routeIndex]?.route[pointIndex]
        assert.equal(Reflect.get(point,"shared")===Reflect.get(original??{},"shared"),Reflect.get(expectedPoint,"shared")===Reflect.get(expectedOriginal??{},"shared"),`${fixture.name} nested metadata alias`)
      }
    }
    priorExpected=wanted;priorActual=result
  }
  console.log(`${fixture.name}: constructor, step state, route bytes and retained identities match`)
}
