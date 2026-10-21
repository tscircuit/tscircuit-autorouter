import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { TopologyMergingSolverParams } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types"
import capturedInput from "../repro/assets/pipeline9-sot23-missing-via.json"

test("inner-layer copper uses full-stack via domains independently of layer count", (): void => {
  for (const layerCount of [4, 6, 8]) {
    const input = {
      ...structuredClone(capturedInput),
      layerCount,
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
    expect(topologyParams.minViaPadDiameter).toBe(solver.viaDiameter)
    solver.solveUntilPhase("portPointPathingSolver")
    expect(
      solver.topologyMergingSolver!.reconstructedViaDomainCount,
    ).toBeGreaterThan(0)
    const routingStage = solver.pipelineDef.find(
      (step) => step.solverName === "portPointPathingSolver",
    )
    if (!routingStage) throw new Error("Missing port-point routing stage")
    const [routingParams] = routingStage.getConstructorParams(solver) as [
      HgPortPointPathingSolverParams,
    ]
    expect(routingParams.initialRoutingMaxIterations).toBe(32_000_000)
  }
})
