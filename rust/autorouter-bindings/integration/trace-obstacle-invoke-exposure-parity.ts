import assert from 'node:assert/strict'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import { MultiSimplifiedPathSolver } from '../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver'
import { TraceSimplificationSolver } from '../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver'
import { importReference } from './tsReference'
const RefMulti=(await importReference<any>('lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts')).MultiSimplifiedPathSolver
const RefTrace=(await importReference<any>('lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts')).TraceSimplificationSolver
function route(): any { return {connectionName:'n',traceThickness:0.1,viaDiameter:0.3,route:[{x:0,y:0,z:0},{x:1,y:0.5,z:0},{x:2,y:0,z:0}],vias:[]} }
function runInvoke(Solver:any):unknown {
 const obstacle={type:'rect',center:{x:1,y:0},width:4,height:4,layers:['top','bottom'],__zLayers:[0,1],connectedTo:['n']}
 const input=route();const solver=new Solver({hdRoutes:[input],obstacles:[obstacle],connMap:new ConnectivityMap({n:['n']}),colorMap:{},defaultViaDiameter:0.3,layerCount:2})
 // No facade field is read before this method returns the object.
 const returned=solver.getSameNetObstacleForSegment(input,{x:0,y:0},{x:2,y:0})
 assert.ok(returned)
 returned.width=0.1;returned.__zLayers.splice(0,returned.__zLayers.length,1)
 const again=solver.getSameNetObstacleForSegment(input,{x:0,y:0},{x:2,y:0})
 while(!solver.solved&&!solver.failed)solver.step()
 const result={foundAgain:again!==undefined,routes:solver.hdRoutes,iterations:solver.iterations,width:returned.width,z:returned.__zLayers,aliasesInput:returned===obstacle}
 solver.dispose?.();return result
}

assert.deepEqual(runInvoke(TraceSimplificationSolver),runInvoke(RefTrace),'invoke exposure')
console.log('Obstacle returned by invoke retains mutation visibility')
