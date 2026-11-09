import { EventEmitter } from "node:events"
import { writeFileSync } from "node:fs"
import { Children, cloneElement, isValidElement } from "react"
import { RootCircuit } from "tscircuit"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { H616DdrBoard } from "./board"

const autorouter = {
  local: true,
  groupMode: "subcircuit",
  async algorithmFn(inputSrj) {
    writeFileSync("remaining.srj.json", JSON.stringify(inputSrj))
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
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

const circuitJson = circuit.getCircuitJson()
writeFileSync("circuit.json", JSON.stringify(circuitJson))
writeFileSync(
  "board.snap.svg",
  convertCircuitJsonToPcbSvg(circuitJson, {
    backgroundColor: "white",
    shouldDrawErrors: true,
    shouldDrawRatsNest: false,
  }),
)
const errors = circuitJson.filter((element) => element.type.endsWith("_error"))
writeFileSync("errors.json", JSON.stringify(errors, null, 2))
console.log(JSON.stringify({ errors: errors.length }))
