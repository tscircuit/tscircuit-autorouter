/** @jsxImportSource react-for-pipeline9-fixtures */
import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { RootCircuit } from "../fixtures/pipeline9CoreRuntime.mjs"

// Use the repository's Pipeline9 through Core's ordinary local-router API.
// Core generates both phase inputs and commits the returned copper itself.
class Pipeline9Autorouter extends EventEmitter {
  readonly solver: AutoroutingPipelineSolver9_PreloadedTraceGraph

  constructor(srj: SimpleRouteJson) {
    super()
    this.solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
      effort: 1,
    })
  }

  start(): void {
    this.solver.solve()
    if (this.solver.failed) {
      this.emit("error", { error: new Error(this.solver.error!) })
      return
    }
    this.emit("complete", {
      traces: this.solver.getOutputSimplifiedPcbTraces(),
    })
  }

  stop(): void {
    // This adapter solves synchronously; Core calls stop after completion.
    // Only the event subscriptions remain to be released.
    this.removeAllListeners("complete")
    this.removeAllListeners("error")
    this.removeAllListeners("progress")
  }
}

test.failing("Pipeline9 retains pad endpoints of a previously routed connection", async (): Promise<void> => {
  const routers: Pipeline9Autorouter[] = []
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  circuit.add(
    <board
      width={10}
      height={10}
      layers={2}
      autorouter={{
        local: true,
        algorithmFn: async (srj: SimpleRouteJson): Promise<Pipeline9Autorouter> => {
          const router = new Pipeline9Autorouter(srj)
          routers.push(router)
          return router
        },
      }}
    >
      <resistor name="R1" resistance="1k" footprint="0402" pcbX={-1.5} pcbY={-1} />
      <resistor name="R2" resistance="1k" footprint="0402" pcbX={1.5} pcbY={1} />
      <resistor name="R3" resistance="1k" footprint="0402" pcbX={-1.5} pcbY={1} />
      <resistor name="R4" resistance="1k" footprint="0402" pcbX={1.5} pcbY={-1} />
      {/* The pinned Core supports phases; the repository's legacy JSX types
          do not yet include these two props. */}
      <trace from="R1.pin1" to="R2.pin1" {...{ width: 0.2, routingPhaseIndex: 0 }} />
      <trace from="R3.pin1" to="R4.pin1" {...{ width: 0.2, routingPhaseIndex: 1 }} />
    </board>,
  )
  await circuit.renderUntilSettled()

  expect(routers).toHaveLength(2)
  expect(routers.map((router) => router.solver.solved)).toEqual([true, true])
  expect(routers[0]!.solver.srj.traces).toHaveLength(0)
  expect(routers[1]!.solver.srj.traces).toEqual(
    routers[0]!.solver.getOutputSimplifiedPcbTraces(),
  )
  const circuitJson = circuit.getCircuitJson() as CircuitJson
  expect(circuitJson.filter((element) => element.type === "pcb_trace")).toHaveLength(2)
  await expect(convertCircuitJsonToPcbSvg(circuitJson)).toMatchSvgSnapshot(
    import.meta.path,
  )
  // Do not exclude any native connectivity, placement, or copper errors.
  expect(circuitJson.filter((element) => element.type.includes("error"))).toEqual([])
})
