import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline3_HgPortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { AutoroutingPipelineSolver4_TinyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver6_PolyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { AutoroutingPipelineSolver8 } from "lib/autorouter-pipelines/AutoroutingPipeline8/AutoroutingPipelineSolver8"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type PipelineConstructor = new (
  srj: SimpleRouteJson,
  options: { cacheProvider: null },
) => BaseSolver

test("every native output path rejects a generated through via crossing inner copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -1, maxX: 4, minY: -1, maxY: 1 },
    minTraceWidth: 0.15,
    minViaDiameter: 0.5,
    obstacles: [
      {
        type: "rect",
        layers: ["inner2"],
        center: { x: 1.5, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: [],
        obstacleId: "inner2-blocker",
      },
    ],
    connections: [
      {
        name: "SIG",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "inner1" },
        ],
      },
    ],
  }
  const generatedRoute: HighDensityRoute = {
    connectionName: "SIG",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1.5, y: 0, z: 0 },
      { x: 1.5, y: 0, z: 1 },
      { x: 3, y: 0, z: 1 },
    ],
    vias: [{ x: 1.5, y: 0 }],
  }
  const pipelineConstructors: Array<[string, PipelineConstructor]> = [
    ["Assignable 1", AssignableAutoroutingPipeline1Solver],
    ["Assignable 2", AssignableAutoroutingPipeline2],
    ["Assignable 3", AssignableAutoroutingPipeline3],
    ["Pipeline 1", AutoroutingPipeline1_OriginalUnravel],
    ["Pipeline 2", AutoroutingPipelineSolver2_PortPointPathing],
    ["Pipeline 3", AutoroutingPipelineSolver3_HgPortPointPathing],
    ["Pipeline 4", AutoroutingPipelineSolver4_TinyHypergraph],
    ["Pipeline 6", AutoroutingPipelineSolver6_PolyHypergraph],
    ["Pipeline 8", AutoroutingPipelineSolver8],
  ]

  for (const [name, Pipeline] of pipelineConstructors) {
    const pipeline = new Pipeline(structuredClone(input), {
      cacheProvider: null,
    }) as BaseSolver & {
      highDensityRouteSolver: object
      netToPointPairsSolver: object
      srjWithPointPairs: object
      _getOutputHdRoutes: () => HighDensityRoute[]
      getOutputSimplifiedPcbTraces: () => unknown
    }
    pipeline.solved = true
    pipeline.highDensityRouteSolver = {}
    pipeline.netToPointPairsSolver = {
      newConnections: structuredClone(input.connections),
    }
    pipeline.srjWithPointPairs = {
      connections: structuredClone(input.connections),
    }
    pipeline._getOutputHdRoutes = () => [generatedRoute]

    expect(
      () => pipeline.getOutputSimplifiedPcbTraces(),
      `${name} emitted an unsafe physical through via`,
    ).toThrow("collides with obstacle inner2-blocker on inner2")
  }
})
