import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { TopologyMergingSolverParams } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { SimpleRouteJson } from "lib/types"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import capturedInput from "../repro/assets/pipeline9-sot23-missing-via.json"

test("only reconstructs free via domains when no preloaded copper needs projection", (): void => {
  const input = {
    ...structuredClone(capturedInput),
    layerCount: 8,
  } as SimpleRouteJson
  expect(input.traces!.length).toBeGreaterThan(0)
  for (const includePreloadedCopper of [true, false]) {
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      {
        ...input,
        traces: includePreloadedCopper ? input.traces : undefined,
      },
      { cacheProvider: null },
    )
    solver.solveUntilPhase("topologyMergingSolver")
    const stage = solver.pipelineDef.find(
      (step) => step.solverName === "topologyMergingSolver",
    )
    if (!stage) throw new Error("Missing topology merging stage")
    const [params] = stage.getConstructorParams(solver) as [
      TopologyMergingSolverParams,
    ]
    expect(params.minViaPadDiameter).toBe(
      includePreloadedCopper ? undefined : solver.viaDiameter,
    )
    solver.solveUntilPhase("portPointPathingSolver")
    const routingStage = solver.pipelineDef.find(
      (step) => step.solverName === "portPointPathingSolver",
    )
    if (!routingStage) throw new Error("Missing port-point routing stage")
    const [routingParams] = routingStage.getConstructorParams(solver) as [
      HgPortPointPathingSolverParams,
    ]
    expect(routingParams.flags.USE_INITIAL_ROUTING_CONTINUATION).toBe(
      !includePreloadedCopper,
    )
  }
})
