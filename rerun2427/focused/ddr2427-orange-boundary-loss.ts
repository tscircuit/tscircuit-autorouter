import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { FanoutSolver } from '/workspace/fanout-boundary-contact-repro-2427/lib/fanout-solver.ts'
import { validateRoutedCopperDrc } from '/workspace/fanout-boundary-contact-repro-2427/lib/validate-routed-copper-drc.ts'
const captured=JSON.parse(gunzipSync(readFileSync('/workspace/ddr-rerun-2427/baseline/boards/orangecrab/fanout-1-input.json.gz')).toString())
const name='breakout:pcb_breakout_point_5'
const input={...captured.solverParams,connections:captured.solverParams.connections.filter(c=>c.name===name),buses:[]}
const reports=[]
for(const direction of [undefined,'down']) {
 const options={...captured.solverOptions,buses:[],busDirections:direction?{[`connection:${name}`]:direction}:undefined}
 const solver=new FanoutSolver(input,options)
 solver.solve()
 const result=solver.solved?solver.getOutput():undefined
 const report={direction:solver.preparedBuses[0].direction,solved:solver.solved,error:solver.error,validation:result?.validation,copper:result?validateRoutedCopperDrc({inputSrj:input,routedSrj:result.simpleRouteJson,clearance:input.minViaEdgeToPadEdgeClearance,allowBlindAndBuriedVias:false}):undefined,traces:result?.fanoutTraces}
 reports.push(report)
}
await Bun.write('/tmp/ddr2427-orange-boundary-loss.json',JSON.stringify(reports,null,2))
console.log(JSON.stringify(reports.map(({traces,...r})=>r),null,2))
