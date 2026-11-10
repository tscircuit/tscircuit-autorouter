import { EventEmitter } from "node:events"
import { mkdirSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { Children, cloneElement, isValidElement } from "react"
import { RootCircuit } from "tscircuit"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import * as checks from "@tscircuit/checks"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { H3DdrStrobeViaAccessBoard } from "./board"
import source from "./source.json"

const output = process.argv[2] ?? import.meta.dir
mkdirSync(output, { recursive: true })
const circuit = new RootCircuit()
const phaseInputs = {}
let routedDqSrj
const autorouter = {
  local: true,
  groupMode: "subcircuit",
  async algorithmFn(input) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    const events = new EventEmitter()
    return {
      on: events.on.bind(events),
      stop: events.removeAllListeners.bind(events),
      getOutputSimpleRouteJson: solver.getOutputSimpleRouteJson.bind(solver),
      start() {
        solver.solve()
        if (solver.failed) {
          events.emit("error", {
            type: "error",
            error: new Error(solver.error),
          })
          return
        }
        events.emit("complete", {
          type: "complete",
          traces: solver.getOutputSimplifiedPcbTraces(),
        })
      },
    }
  },
}
const board = H3DdrStrobeViaAccessBoard()
const children = Children.map(board.props.children, (child) => {
  if (
    isValidElement(child) &&
    child.type === "autoroutingphase" &&
    child.props.name === "remaining"
  ) {
    return cloneElement(child, { autorouter })
  }
  return child
})
circuit.on("autorouting:start", (event) => {
  phaseInputs[event.phaseName] = event.simpleRouteJson
})
circuit.on("autorouting:end", (event) => {
  if (event.phaseName === "byte1") {
    routedDqSrj = structuredClone(event.simpleRouteJson)
  }
})
circuit.add(cloneElement(board, {}, children))
await circuit.renderUntilSettled()

const circuitJson = circuit.getCircuitJson()
const connectivity = new PcbConnectivityMap(circuitJson)
const ports = new Map(
  circuit.db.pcb_port
    .list()
    .map((port) => [port.source_port_id, port.pcb_port_id]),
)
const requestedNames = new Set(source.requestedNames)
const requestedTraces = circuit.db.source_trace
  .list()
  .filter((trace) => requestedNames.has(trace.name))
const connected = requestedTraces.filter((trace) =>
  connectivity.connMap.areAllIdsConnected(
    trace.connected_source_port_ids.map((port) => ports.get(port)),
  ),
).length
const physicalChecks = {
  overlap: checks.checkEachPcbTraceNonOverlapping(circuitJson, {
    minClearance: 0.0889,
  }),
  padTrace: checks.checkPadTraceClearance(circuitJson, {
    minClearance: 0.0889,
  }),
  viaTrace: checks.checkViaTraceClearance(circuitJson, {
    minClearance: 0.0889,
  }),
  viaPad: checks.checkViaPadClearance(circuitJson, {
    minClearance: 0.0889,
  }),
  viaSpacing: checks.checkDifferentNetViaSpacing(circuitJson),
  continuity: checks.checkTracesAreContiguous(circuitJson),
  viaInPad: checks.checkViasInPads(circuitJson),
  outOfBoard: checks.checkPcbTracesOutOfBoard(circuitJson),
  selfShorts: checks.checkPcbTraceSelfShorts(circuitJson),
}
const result = {
  requested: requestedTraces.length,
  connected,
  nativePads: circuit.db.pcb_smtpad.list().length,
  physicalFindings: Object.fromEntries(
    Object.entries(physicalChecks).map(([name, findings]) => [
      name,
      findings.filter((finding) => finding.type.endsWith("_error")).length,
    ]),
  ),
}
const annotatedCircuit = [
  ...circuitJson,
  {
    type: "pcb_note_text",
    pcb_note_text_id: "routing_status",
    pcb_group_id: "routing_status",
    font: "tscircuit2024",
    font_size: 0.5,
    layer: "top",
    anchor_alignment: "center",
    anchor_position: { x: 0, y: 9.6 },
    text: `${connected}/17 requested signals connected; 16 DQ + DQS1+`,
  },
]
writeFileSync(
  `${output}/board.snap.svg`,
  convertCircuitJsonToPcbSvg(annotatedCircuit, {
    backgroundColor: "white",
    width: 1400,
    height: 900,
    shouldDrawErrors: false,
    shouldDrawRatsNest: connected !== 17,
    showPcbGroups: false,
    showDebugObjects: false,
    showErrorsInTextOverlay: false,
  }),
)
writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2) + "\n")
writeFileSync(`${output}/circuit.json`, JSON.stringify(circuitJson))
writeFileSync(
  `${output}/input.srj.json.gz`,
  gzipSync(JSON.stringify(phaseInputs.remaining)),
)
writeFileSync(
  `${output}/routed-data.srj.json.gz`,
  gzipSync(
    JSON.stringify({
      ...phaseInputs.byte0,
      connections: [
        ...phaseInputs.byte0.connections,
        ...phaseInputs.byte1.connections,
      ],
      traces: routedDqSrj.traces,
    }),
  ),
)
console.log(JSON.stringify(result))
