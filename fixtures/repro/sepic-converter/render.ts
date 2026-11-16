import type { AnyCircuitElement } from "circuit-json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { RootCircuit } from "tscircuit-for-sepic-repro"
import Board from "./board"

type RoutingListener = (event: {
  type: "complete"
  traces: ReturnType<
    AutoroutingPipelineSolver9_PreloadedTraceGraph["getOutputSimplifiedPcbTraces"]
  >
}) => void

type NativeAutorouter = {
  on: (event: string, listener: RoutingListener) => void
  stop: () => void
  start: () => void
  getOutputSimpleRouteJson: () => SimpleRouteJson
}

export async function renderSepicRepro(): Promise<{
  solver: AutoroutingPipelineSolver9_PreloadedTraceGraph
  input: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
}> {
  const circuit = new RootCircuit()
  let solver: AutoroutingPipelineSolver9_PreloadedTraceGraph | undefined
  let input: SimpleRouteJson | undefined
  circuit.add(
    Board({
      autorouter: {
        local: true,
        groupMode: "subcircuit",
        algorithmFn: async (srj: SimpleRouteJson): Promise<NativeAutorouter> => {
          input = srj
          const routingSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
            srj,
            { cacheProvider: null, effort: 1 },
          )
          solver = routingSolver
          const listeners = new Map<string, RoutingListener>()
          return {
            on: (event: string, listener: RoutingListener): void => {
              listeners.set(event, listener)
            },
            stop: (): void => {
              listeners.clear()
            },
            getOutputSimpleRouteJson: (): SimpleRouteJson =>
              routingSolver.getOutputSimpleRouteJson(),
            start: (): void => {
              routingSolver.solve()
              if (routingSolver.failed) throw new Error(routingSolver.error!)
              listeners.get("complete")!({
                type: "complete",
                traces: routingSolver.getOutputSimplifiedPcbTraces(),
              })
            },
          }
        },
      },
    }),
  )
  circuit.platform = { ...circuit.platform, partsEngine: undefined }
  await circuit.renderUntilSettled()
  if (!solver || !input) {
    throw new Error("Expected Pipeline 9 to route the TSX board")
  }
  return {
    solver,
    input,
    // The board uses the common PCB elements supported by the repo's renderer.
    circuitJson: circuit.getCircuitJson() as AnyCircuitElement[],
  }
}
