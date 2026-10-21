import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { TopologyMergingSolverParams } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import capturedInput from "../repro/assets/pipeline9-sot23-missing-via.json"

test("established layer stacks retain their original topology, stitching, and budget", (): void => {
  for (const layerCount of [2, 4, 6]) {
    const input = {
      ...structuredClone(capturedInput),
      layerCount,
      traces: undefined,
    } as SimpleRouteJson
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    solver.solveUntilPhase("topologyMergingSolver")
    const topologyStage = solver.pipelineDef.find(
      (step) => step.solverName === "topologyMergingSolver",
    )
    if (!topologyStage) throw new Error("Missing topology merging stage")
    const [topologyParams] = topologyStage.getConstructorParams(solver) as [
      TopologyMergingSolverParams,
    ]
    expect(topologyParams.minViaPadDiameter).toBeUndefined()
    solver.solveUntilPhase("portPointPathingSolver")
    const routingStage = solver.pipelineDef.find(
      (step) => step.solverName === "portPointPathingSolver",
    )
    if (!routingStage) throw new Error("Missing port-point routing stage")
    const [routingParams] = routingStage.getConstructorParams(solver) as [
      HgPortPointPathingSolverParams,
    ]
    expect(routingParams.flags.USE_INITIAL_ROUTING_CONTINUATION).toBe(false)
    Reflect.set(solver, "highDensityRouteSolver", { routes: [] })
    const stitchStage = solver.pipelineDef.find(
      (step) => step.solverName === "highDensityStitchSolver",
    )
    if (!stitchStage) throw new Error("Missing route stitching stage")
    const [stitchParams] = stitchStage.getConstructorParams(solver) as [
      ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0],
    ]
    expect(stitchParams.preferSameLayerTerminalEndpoints).toBe(true)
    expect(stitchParams.strictTerminalLayerIdentity).toBe(false)
    const stitchSolver = new MultipleHighDensityRouteStitchSolver3(stitchParams)
    expect(Reflect.get(stitchSolver, "strictTerminalLayerIdentity")).toBe(false)
  }
})
