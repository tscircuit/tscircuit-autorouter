/** @jsxImportSource react */
import { EventEmitter } from "node:events"
import { Children, cloneElement, isValidElement } from "react"
import { RootCircuit, checks, convertCircuitJsonToPcbSvg } from "./runtime.mjs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../../lib/types"
import { board } from "./board"
import source from "./source-data.json"

const circuit = new RootCircuit()
const routingErrors: string[] = []
const completedDataTraces: SimplifiedPcbTrace[] = []
let routingSolver: AutoroutingPipelineSolver9_PreloadedTraceGraph | undefined
circuit.on("autorouting:end", (event) => {
  if (event.phaseName === "byte1") {
    completedDataTraces.push(...event.simpleRouteJson.traces)
  }
})
const autorouter = {
  local: true,
  async algorithmFn(input: SimpleRouteJson) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    routingSolver = solver
    const events = new EventEmitter()
    return {
      on: events.on.bind(events),
      stop: events.removeAllListeners.bind(events),
      getOutputSimpleRouteJson: solver.getOutputSimpleRouteJson.bind(solver),
      start(): void {
        try {
          solver.solve()
          if (solver.failed) throw new Error(solver.error!)
          events.emit("complete", {
            type: "complete",
            traces: solver.getOutputSimplifiedPcbTraces(),
          })
        } catch (error) {
          routingErrors.push(String(error))
          events.emit("error", { type: "error", error })
        }
      },
    }
  },
}
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
circuit.add(cloneElement(board, {}, children))
await circuit.renderUntilSettled()
const json = circuit.getCircuitJson()
const minClearance = source.rules.appliedGlobalClearance
const physicalErrors = [
  ...checks.checkEachPcbTraceNonOverlapping(json, { minClearance }),
  ...checks.checkPadTraceClearance(json, { minClearance }),
  ...checks.checkViaTraceClearance(json, { minClearance }),
  ...checks.checkViaPadClearance(json, { minClearance }),
  ...checks.checkDifferentNetViaSpacing(json),
  ...checks.checkTracesAreContiguous(json),
  ...checks.checkViasInPads(json),
].filter((finding) => finding.type.endsWith("_error"))
const svg = convertCircuitJsonToPcbSvg(json, {
  backgroundColor: "white",
  width: 1400,
  height: 1000,
  viewport: { minX: -7, maxX: 23, minY: -8.5, maxY: 10.5 },
  shouldDrawRatsNest: false,
  shouldDrawErrors: false,
  showPcbGroups: false,
})
console.log(
  JSON.stringify({
    circuitJson: json,
    svg,
    completedDataTraces,
    routingErrors,
    physicalErrors,
    solved: routingSolver?.solved,
    failed: routingSolver?.failed,
  }),
)
