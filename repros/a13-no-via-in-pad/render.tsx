/** @jsxImportSource react-for-pipeline9-fixtures */
import { EventEmitter } from "node:events"
import { mkdirSync, writeFileSync } from "node:fs"
import {
  Children,
  cloneElement,
  isValidElement,
} from "react-for-pipeline9-fixtures"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"
import { NativeA13DdrThermalPadBoard } from "./board"
import { RootCircuit, checks, convertCircuitJsonToPcbSvg } from "./runtime.mjs"

type NativeAutorouter = {
  on: EventEmitter["on"]
  start: () => void
  stop: () => void
  getOutputSimpleRouteJson: () => SimpleRouteJson
}

const circuit = new RootCircuit()
let dataBits = [0, 1, 2, 3]
if (process.argv[2]) dataBits = process.argv[2].split(",").map(Number)
const board = NativeA13DdrThermalPadBoard({ dataBits })
let inputSrj: SimpleRouteJson | undefined
let solver: AutoroutingPipelineSolver9_PreloadedTraceGraph | undefined
const autorouter = {
  local: true,
  groupMode: "subcircuit",
  async algorithmFn(input: SimpleRouteJson): Promise<NativeAutorouter> {
    inputSrj = input
    const routingSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      input,
      { cacheProvider: null },
    )
    solver = routingSolver
    const events = new EventEmitter()
    return {
      on: events.on.bind(events),
      stop: events.removeAllListeners.bind(events),
      getOutputSimpleRouteJson:
        routingSolver.getOutputSimpleRouteJson.bind(routingSolver),
      start(): void {
        try {
          routingSolver.solve()
          if (routingSolver.failed) {
            throw new Error(routingSolver.error!)
          }
          events.emit("complete", {
            type: "complete",
            traces: routingSolver.getOutputSimplifiedPcbTraces(),
          })
        } catch (error) {
          events.emit("error", { type: "error", error })
        }
      },
    }
  },
}
const children = Children.map(board.props.children, (child) => {
  if (isValidElement(child) && child.type === "autoroutingphase") {
    return cloneElement(child, { autorouter })
  }
  return child
})
circuit.add(cloneElement(board, {}, children))
await circuit.renderUntilSettled()
if (!inputSrj || !solver?.solved) {
  throw new Error("The native A13 routing phase did not complete")
}
const json = circuit.getCircuitJson()
const selectedNames = new Set(
  dataBits.flatMap((bit) => [`CPU_D${bit}`, `DRAM_D${bit}`]),
)
const selected = json.filter(
  (element) =>
    element.type !== "source_trace" || selectedNames.has(element.name),
)
const physical = [
  ...checks.checkEachPcbTraceNonOverlapping(json, { minClearance: 0.2 }),
  ...checks.checkPadTraceClearance(json, { minClearance: 0.2 }),
  ...checks.checkViaTraceClearance(json, { minClearance: 0.2 }),
  ...checks.checkViaPadClearance(json, { minClearance: 0.2 }),
  ...checks.checkTracesAreContiguous(json),
].filter((finding) => finding.type.endsWith("_error"))
const summary = {
  allowViaInPad: inputSrj.allowViaInPad,
  traces: json.filter((element) => element.type === "pcb_trace").length,
  vias: json.filter((element) => element.type === "pcb_via").length,
  viaInPad: checks.checkViasInPads(json),
  otherPhysicalErrors: physical,
  connectivity: checks.checkEachPcbPortConnectedToPcbTraces(selected),
}
if (summary.traces !== dataBits.length * 2 || summary.connectivity.length > 0) {
  throw new Error("The native A13 selected paths were not fully connected")
}
const directory = process.argv[3] ?? import.meta.dir
mkdirSync(directory, { recursive: true })
writeFileSync(`${directory}/circuit.json`, JSON.stringify(json))
writeFileSync(`${directory}/input.srj.json`, JSON.stringify(inputSrj))
writeFileSync(
  `${directory}/output.srj.json`,
  JSON.stringify(solver.getOutputSimpleRouteJson()),
)
writeFileSync(
  `${directory}/result.json`,
  JSON.stringify(summary, null, 2) + "\n",
)
for (const [name, viewport] of [
  ["board", { minX: -14, maxX: 40, minY: -21, maxY: 22 }],
  ["ram-detail", { minX: -8, maxX: 3, minY: -3, maxY: 5 }],
] as const) {
  const svg = convertCircuitJsonToPcbSvg(json, {
    backgroundColor: "white",
    width: 1400,
    height: 1000,
    viewport,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    showPcbGroups: false,
  })
  writeFileSync(`${directory}/${name}.svg`, svg)
}
console.log(JSON.stringify(summary))
