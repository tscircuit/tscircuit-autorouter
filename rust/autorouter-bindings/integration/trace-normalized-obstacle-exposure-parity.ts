import assert from 'node:assert/strict'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import { MultiSimplifiedPathSolver } from '../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver'
import { TraceSimplificationSolver } from '../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver'
import { importReference } from './tsReference'
const RefMulti=(await importReference<any>('lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts')).MultiSimplifiedPathSolver
const RefTrace=(await importReference<any>('lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts')).TraceSimplificationSolver
function route(): any { return {connectionName:'n',traceThickness:0.1,viaDiameter:0.3,route:[{x:0,y:0,z:0},{x:1,y:0.5,z:0},{x:2,y:0,z:0}],vias:[]} }
function runNormalized(Solver: any, observe: boolean): unknown {
 const center={x:1,y:0};const connectedTo=['blocked'];const suppliedZ=[0]
 const obstacle={type:'rect',center,width:0.3,height:0.3,layers:['top'],__zLayers:suppliedZ,connectedTo}
 const solver=new Solver({unsimplifiedHdRoutes:[route()],obstacles:[obstacle],connMap:new ConnectivityMap({n:['n']})})
 let retained:any
 if(observe) retained=solver.obstacles[0]
 suppliedZ.push(1);obstacle.width=100;obstacle.center={x:100,y:100};center.y=0.02
 solver.step()
 if(observe){retained.width=0.7;retained.__zLayers.push(1)}
 while(!solver.solved&&!solver.failed)solver.step()
 const normalized=solver.obstacles[0]
 const result={routes:solver.simplifiedHdRoutes,iterations:solver.iterations,normalized:{width:normalized.width,center:normalized.center,z:normalized.__zLayers},freshZ:normalized.__zLayers!==suppliedZ,sharedCenter:normalized.center===center,sharedConnected:normalized.connectedTo===connectedTo,retained:!observe||normalized===retained,suppliedZ:[...suppliedZ]}
 solver.dispose?.();return result
}

for(const observed of [false,true])assert.deepEqual(runNormalized(MultiSimplifiedPathSolver,observed),runNormalized(RefMulti,observed),`normalized observed=${observed}`)
console.log('Normalized source and observed-object mutation parity passed')
