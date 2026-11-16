import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { RootCircuit, getSimpleRouteJsonFromCircuitJson } from "./core-runtime.mjs"
import { NativeFullBoard, type FullBoardSource } from "./native-full-board"
import { EscapeViaLocationSolver } from "../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { EscapeViaLocationSolver as BaselineEscapeViaLocationSolver } from "../../lib/solvers/EscapeViaLocationSolver/BaselineEscapeViaLocationSolver"
import { NetToPointPairsSolver } from "../../lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "../../lib/utils/get-initially-connected-map-from-simple-route-json"
import type { SimpleRouteJson } from "../../lib/types"

const output=resolve(process.argv[2])
mkdirSync(output,{recursive:true})
const rows: unknown[]=[]
for(const id of ["h616","icepi","glider","orangecrab","butterstick","imx6"]) {
  const source: FullBoardSource=JSON.parse(readFileSync(join(import.meta.dir,id,"source.json"),"utf8"))
  const circuit=new RootCircuit()
  circuit.add(<NativeFullBoard source={source} geometryOnly />)
  circuit.render()
  const json=circuit.getCircuitJson()
  const initialCopper=json.filter((e)=>["pcb_trace","pcb_via","pcb_copper_pour"].includes(e.type)).length
  if(initialCopper!==0)throw new Error("Prepared benchmark input already contains copper")
  if(json.filter((e)=>e.type==="source_component").length!==source.parts.length)throw new Error("Incomplete component preparation")
  const planeNames=new Set(source.planeIntent.zones.filter((z)=>z.unbroken && z.outlines.length).map((z)=>z.netName))
  const netIds=new Set(json.filter((e)=>e.type==="source_net" && planeNames.has(e.name)).map((e)=>e.source_net_id))
  const board=circuit.firstChild!
  const {simpleRouteJson}=getSimpleRouteJsonFromCircuitJson({db:circuit.db,subcircuit_id:board.subcircuit_id,subcircuitComponent:board as any,
    minTraceWidth:Math.min(...source.nets.filter((n)=>n.routable).map((n)=>n.width))})
  const input={...simpleRouteJson,connections:simpleRouteJson.connections.filter((c)=>netIds.has(c.name))} as SimpleRouteJson
  writeFileSync(join(output,`${id}-plane-input.srj.json`),JSON.stringify(input))
  for(const [variant,Solver] of [["baseline",BaselineEscapeViaLocationSolver],["connected_regions",EscapeViaLocationSolver]] as const) {
    const started=performance.now()
    const escape=new Solver(structuredClone(input))
    escape.solve()
    if(!escape.solved || escape.failed)throw new Error(`Plane escape preparation failed: ${id}`)
    const escaped=escape.getOutputSimpleRouteJson()
    const pairs=new NetToPointPairsSolver(escaped,{},getInitiallyConnectedMapFromSimpleRouteJson(escaped))
    pairs.solve()
    if(!pairs.solved || pairs.failed)throw new Error(`Plane edge preparation failed: ${id}`)
    const row={id,variant,sourceNets:input.connections.length,sourceTerminals:input.connections.reduce((n,c)=>n+c.pointsToConnect.length,0),
      escapeVias:escape.createdEscapeVias.length,externalGroups:escaped.connections.flatMap((c)=>c.externallyConnectedPointIds??[]).length,
      requestedRoutes:pairs.newConnections.length,elapsedMs:performance.now()-started,initialCopper}
    rows.push(row)
    writeFileSync(join(output,`${id}-${variant}-requests.srj.json`),JSON.stringify({...escaped,connections:pairs.newConnections}))
    console.log("PLANE_DEMAND_RESULT "+JSON.stringify(row))
  }
}
writeFileSync(join(output,"summary.json"),JSON.stringify(rows,null,2))
console.log("PLANE_DEMAND_SUMMARY_BEGIN")
console.log(JSON.stringify(rows))
console.log("PLANE_DEMAND_SUMMARY_END")
// Geometry-only circuits queued pour effects. This job benchmarks preparation
// from an empty copper state, so those asynchronous fills are not executed.
process.exit(0)
