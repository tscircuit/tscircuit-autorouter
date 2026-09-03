import { EventEmitter } from "node:events"
import {
  type AutorouterCompleteEvent,
  type AutorouterErrorEvent,
  type AutorouterProgressEvent,
  type GenericLocalAutorouter,
  type SimpleRouteJson,
  type SimplifiedPcbTrace,
} from "@tscircuit/core"
import { expect, mock, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { Am625SipPmicBuck2 } from "../../fixtures/repro/am625sip-pmic-buck2/am625sip-pmic-buck2.fixture"
import * as localAutorouter from "../../lib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

mock.module("@tscircuit/capacity-autorouter", () => localAutorouter)

class Pipeline9CoreBinding
  extends EventEmitter
  implements GenericLocalAutorouter
{
  input: SimpleRouteJson
  isRouting = false
  private readonly solver: AutoroutingPipelineSolver9_PreloadedTraceGraph

  constructor(input: SimpleRouteJson) {
    super()
    this.input = input
    this.solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
      effort: 1,
    })
  }

  start(): void {
    this.isRouting = true
    queueMicrotask(() => {
      if (!this.isRouting) return
      this.solver.solve()
      this.isRouting = false
      if (this.solver.failed) {
        this.emit("error", {
          type: "error",
          error: new Error(this.solver.error ?? "Pipeline9 routing failed"),
        } satisfies AutorouterErrorEvent)
        return
      }
      this.emit("complete", {
        type: "complete",
        traces: this.solver.getOutputSimplifiedPcbTraces(),
      } satisfies AutorouterCompleteEvent)
    })
  }

  stop(): void {
    this.isRouting = false
  }

  on(
    event: "complete",
    callback: (event: AutorouterCompleteEvent) => void,
  ): this
  on(event: "error", callback: (event: AutorouterErrorEvent) => void): this
  on(
    event: "progress",
    callback: (event: AutorouterProgressEvent) => void,
  ): this
  on(event: string, callback: (...args: unknown[]) => void): this {
    return super.on(event, callback)
  }

  solveSync(): SimplifiedPcbTrace[] {
    this.solver.solve()
    if (this.solver.failed) {
      throw new Error(this.solver.error ?? "Pipeline9 routing failed")
    }
    return this.solver.getOutputSimplifiedPcbTraces()
  }
}

test("Pipeline9 routes the AM625SiP PMIC buck2 subcircuit", async (): Promise<void> => {
  const { RootCircuit } = await import("@tscircuit/core")
  const circuit = new RootCircuit()
  circuit.add(
    <Am625SipPmicBuck2
      autorouter={{
        local: true,
        groupMode: "subcircuit",
        async algorithmFn(input) {
          return new Pipeline9CoreBinding(input)
        },
      }}
    />,
  )

  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson()
  const pcbSvg = convertCircuitJsonToPcbSvg(circuitJson, {
    backgroundColor: "#0f172a",
    matchBoardAspectRatio: true,
  })
  expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)

  const autoroutingErrors = circuitJson
    .filter((element) => element.type === "pcb_autorouting_error")
  expect(autoroutingErrors).toHaveLength(0)
})
