import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { Children, cloneElement, isValidElement } from "react"
import { RootCircuit } from "tscircuit"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { H616DdrBoard } from "./board"

const fixture = JSON.parse(
  gunzipSync(
    readFileSync(
      new URL(
        "../../fixtures/assets/h616-ordered-clocks-ddr.json.gz",
        import.meta.url,
      ),
    ),
  ).toString(),
)
const hash = createHash("sha256")
  .update(JSON.stringify(fixture.srj))
  .digest("hex")
const autorouter = {
  local: true,
  groupMode: "subcircuit",
  async algorithmFn(input) {
    const actualHash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex")
    if (actualHash !== hash) {
      throw Error("Native TSX differs from the captured Core request")
    }
    writeFileSync("remaining.srj.json", JSON.stringify(input))
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
const board = H616DdrBoard()
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
const circuit = new RootCircuit()
circuit.add(cloneElement(board, {}, children))
await circuit.renderUntilSettled()

const json = circuit.getCircuitJson()
writeFileSync("circuit.json", JSON.stringify(json))
const connectivity = new PcbConnectivityMap(json)
const ports = new Map(
  circuit.db.pcb_port
    .list()
    .map((port) => [port.source_port_id, port.pcb_port_id]),
)
const requested = circuit.db.source_trace.list()
const connected = requested.filter((trace) =>
  connectivity.connMap.areAllIdsConnected(
    trace.connected_source_port_ids.map((portId) => ports.get(portId)),
  ),
).length
if (connected !== requested.length) {
  throw Error("The native board did not finish routing")
}
const errors = json.filter((element) => element.type.endsWith("_error"))
writeFileSync("errors.json", JSON.stringify(errors, null, 2))
const result = {
  connected,
  requested: requested.length,
  physicalFindings: errors.length,
  widthWarnings: json.filter((element) => element.type === "pcb_trace_warning")
    .length,
  inputSha256: hash,
}
writeFileSync(
  new URL("result.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
)
writeFileSync(
  new URL("board.snap.svg", import.meta.url),
  convertCircuitJsonToPcbSvg(json, {
    backgroundColor: "white",
    width: 1400,
    height: 1000,
    shouldDrawErrors: true,
    showErrorsInTextOverlay: false,
    showPcbNotes: false,
    shouldDrawRatsNest: false,
    viewport: { minX: -15, minY: -11, maxX: 13, maxY: 25 },
  }),
)
console.log(JSON.stringify(result))
