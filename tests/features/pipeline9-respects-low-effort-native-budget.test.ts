import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../repro/assets/pipeline9-sot23-missing-via.json"

test("explicit low effort keeps its requested native budget", (): void => {
  for (const effort of [0.01, 1]) {
    const input = {
      ...structuredClone(capturedInput),
      layerCount: 8,
      traces: undefined,
    } as SimpleRouteJson
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      effort,
      cacheProvider: null,
    })
    pipeline.solveUntilPhase("portPointPathingSolver")
    const stage = pipeline.pipelineDef.find(
      (step) => step.solverName === "portPointPathingSolver",
    )
    if (!stage) throw new Error("Missing port-point routing stage")
    const [params] = stage.getConstructorParams(pipeline) as [
      HgPortPointPathingSolverParams,
    ]
    expect(params.effort).toBe(effort)
    expect(params.flags.USE_INITIAL_ROUTING_CONTINUATION).toBe(true)
    const pathing = new TinyHypergraphPortPointPathingSolver(params)
    expect(Reflect.get(pathing, "allowInitialRoutingContinuation")).toBe(
      effort >= 1,
    )
  }
})
