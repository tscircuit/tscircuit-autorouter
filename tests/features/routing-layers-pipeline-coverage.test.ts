import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import { AutoroutingPipeline1_OriginalUnravel } from "lib/autorouter-pipelines/AutoroutingPipeline1_OriginalUnravel/AutoroutingPipeline1_OriginalUnravel"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline3_HgPortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { AutoroutingPipelineSolver4_TinyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver6_PolyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver8 } from "lib/autorouter-pipelines/AutoroutingPipeline8/AutoroutingPipelineSolver8"
import type { SimpleRouteJson } from "lib/types"
import { routeUsesOnlyRoutingLayers } from "../helpers/route-uses-only-routing-layers"

test("routing pipelines constrain generated candidates to the allowed z layers", () => {
  const input = {
    layerCount: 4,
    routingLayers: ["top", "bottom"],
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "outer_layers",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "bottom" },
        ],
      },
    ],
  } satisfies SimpleRouteJson
  const allowedLayers = new Set(input.routingLayers)
  const outputSolvers = [
    new AutoroutingPipeline1_OriginalUnravel(structuredClone(input)),
    new AutoroutingPipelineSolver2_PortPointPathing(structuredClone(input)),
    new AutoroutingPipelineSolver4_TinyHypergraph(structuredClone(input)),
    new AutoroutingPipelineSolver6_PolyHypergraph(structuredClone(input)),
    new AutoroutingPipelineSolver7_MultiGraph(structuredClone(input)),
    new AssignableAutoroutingPipeline2(structuredClone(input)),
    new AssignableAutoroutingPipeline3(structuredClone(input)),
  ]

  for (const solver of outputSolvers) {
    solver.solve()
    const traces = solver.getOutputSimpleRouteJson().traces ?? []
    expect(solver.failed).toBe(false)
    expect(traces.length).toBeGreaterThan(0)
    expect(
      traces.every((trace) => routeUsesOnlyRoutingLayers(trace, allowedLayers)),
    ).toBe(true)
  }

  const candidateSolvers = [
    new AutoroutingPipelineSolver3_HgPortPointPathing(structuredClone(input)),
    new AutoroutingPipelineSolver8(structuredClone(input)),
  ]
  for (const solver of candidateSolvers) {
    solver.solveUntilPhase("edgeSolver")
    expect(solver.failed).toBe(false)
    expect(
      solver.capacityNodes?.every((node) =>
        node.availableZ.every((z) => z === 0 || z === 3),
      ),
    ).toBe(true)
  }

  const assignableCandidateSolver = new AssignableAutoroutingPipeline1Solver(
    structuredClone(input),
  )
  assignableCandidateSolver.solveUntilPhase("singleLayerNodeMerger")
  expect(assignableCandidateSolver.failed).toBe(false)
  expect(
    assignableCandidateSolver.capacityNodes?.every((node) =>
      node.availableZ.every((z) => z === 0 || z === 3),
    ),
  ).toBe(true)
})
