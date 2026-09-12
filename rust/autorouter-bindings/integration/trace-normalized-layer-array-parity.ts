import assert from 'node:assert/strict'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import { MultiSimplifiedPathSolver } from '../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver'
import { TraceSimplificationSolver } from '../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver'
import { importReference } from './tsReference'
const RefMulti=(await importReference<any>('lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts')).MultiSimplifiedPathSolver
const RefTrace=(await importReference<any>('lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts')).TraceSimplificationSolver
function route(): any { return {connectionName:'n',traceThickness:0.1,viaDiameter:0.3,route:[{x:0,y:0,z:0},{x:1,y:0.5,z:0},{x:2,y:0,z:0}],vias:[]} }

function runLayers(Solver: any): unknown {
 const sharedValid=[0,1]
 const obstacles=[[],[-1,9],sharedValid,sharedValid,[NaN,Infinity,"0",null]].map((z,index)=>({type:'rect',center:{x:10+index,y:10},width:0.3,height:0.3,__zLayers:z,connectedTo:[]}))
 const solver=new Solver({unsimplifiedHdRoutes:[route()],obstacles,connMap:new ConnectivityMap({n:['n']})})
 const normalized=solver.obstacles
 const identities={fallbackShared:normalized[0].__zLayers===normalized[1].__zLayers,validFresh:normalized[2].__zLayers!==sharedValid&&normalized[3].__zLayers!==sharedValid,validDistinct:normalized[2].__zLayers!==normalized[3].__zLayers,invalidFallbackShared:normalized[4].__zLayers===normalized[0].__zLayers}
 normalized[0].__zLayers.pop()
 normalized[2].__zLayers.splice(0,1)
 solver.step()
 const result={identities,retained:solver.obstacles===normalized,layers:normalized.map((o:any)=>o.__zLayers),sourceLayers:obstacles.map(o=>o.__zLayers)}
 solver.dispose?.();return result
}
assert.deepEqual(runLayers(MultiSimplifiedPathSolver),runLayers(RefMulti),'normalization array allocation and shared fallback')
console.log('Normalized valid arrays and shared fallback array match frozen TS')
