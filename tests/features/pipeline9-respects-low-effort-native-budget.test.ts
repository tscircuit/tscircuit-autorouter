import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../repro/assets/pipeline9-sot23-missing-via.json"
import { TinyHyperGraphSectionPipelineSolver } from "tiny-hypergraph/lib/index"

test("explicit low effort keeps its requested native budget", (): void => {
  for (const effort of [0.01, 1]) {
    const input = {
      ...structuredClone(capturedInput),
      layerCount: 8,
      traces: undefined,
    } as SimpleRouteJson
    input.obstacles.push({
      type: "rect",
      center: { x: 8, y: 5 },
      width: 0.2,
      height: 0.2,
      layers: ["inner1"],
      connectedTo: [],
    })
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
    const expectedBudget = effort >= 1 ? 32_000_000 : undefined
    expect(params.initialRoutingMaxIterations).toBe(expectedBudget)
    const pathing = new TinyHypergraphPortPointPathingSolver(params)
    const nativePipeline = Reflect.get(pathing, "tinyPipelineSolver")
    if (!(nativePipeline instanceof TinyHyperGraphSectionPipelineSolver)) {
      throw new Error("Missing native routing pipeline")
    }
    expect(
      nativePipeline.inputProblem.solveGraphOptions
        ?.INITIAL_ROUTING_MAX_ITERATIONS,
    ).toBe(expectedBudget)
  }
})
