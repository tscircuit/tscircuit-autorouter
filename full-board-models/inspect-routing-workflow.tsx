import type { Board } from "@tscircuit/core"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { RootCircuit } from "./core-runtime.mjs"
import { NativeFullBoard, type FullBoardSource } from "./native-full-board"

const [id, outputPath] = process.argv.slice(2)
const sourceBytes = readFileSync(new URL(`./${id}/source.json`, import.meta.url))
const source: FullBoardSource = JSON.parse(sourceBytes.toString())
const circuit = new RootCircuit()
circuit.add(<NativeFullBoard source={source} geometryOnly />)
circuit.render()
const board = circuit.firstChild as Board
const plans = board._getRoutingPhasePlans().map((plan) => ({
  name: plan.phaseName ?? circuit.db.pcb_group.get(plan.routingPcbGroupId!)?.name,
  autorouter: plan.autorouter,
  phaseIndex: plan.routingPhaseIndex,
  fanoutRegionPcbGroupId: plan.fanoutRegionPcbGroupId,
  fanoutBounds: plan.fanoutBounds,
  netNames: plan.nets.map((net) => net.name),
  traces: plan.traces.length,
}))
const fanouts = plans.flatMap((plan, index) => plan.autorouter === "fanout" ? [index] : [])
const buses = plans.flatMap((plan, index) => plan.autorouter === "bus_lanes" ? [index] : [])
const remaining = plans.flatMap((plan, index) => plan.autorouter === "auto_local" ? [index] : [])
if (!fanouts.length || !buses.length || !remaining.length) {
  throw new Error("Full-board workflow must schedule fanout, bus lanes and remaining nets")
}
if (Math.max(...fanouts) >= Math.min(...buses) || Math.max(...buses) >= Math.min(...remaining)) {
  throw new Error("Full-board workflow must run fanout before buses before remaining nets")
}
if (plans.some((plan) => plan.name === "plane_escape")) {
  throw new Error("Bulk plane routing must not precede the DDR buses")
}
const json = circuit.getCircuitJson()
const initialCopperElements = json.filter((element) =>
  ["pcb_trace", "pcb_via", "pcb_copper_pour"].includes(element.type),
).length
if (initialCopperElements !== 0) throw new Error("Workflow input contains saved copper")
const report = {
  id,
  sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  initialCopperElements,
  components: source.parts.length,
  pads: source.parts.reduce((count, part) => count + part.pads.length, 0),
  routableNets: source.nets.filter((net) => net.routable).length,
  plans,
}
writeFileSync(outputPath, JSON.stringify(report, null, 2))
console.log("FANOUT_BUS_WORKFLOW_PLAN", JSON.stringify(report))
// This inspects geometry and scheduling; asynchronous routing is run separately.
process.exit(0)
