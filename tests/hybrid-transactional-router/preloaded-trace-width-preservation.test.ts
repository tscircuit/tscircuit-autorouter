import { expect, test } from "bun:test"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { verifyFinalBoard } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/final-board-verifier"
import { buildInitialCopperSnapshot } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-store"
import type { SimpleRouteJson } from "lib/types"

test("preserves a compiled preloaded width independently of new-copper width", () => {
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    bounds: { minX: -5, maxX: 5, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "power",
        nominalTraceWidth: 0.3,
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "power:start" },
          { x: 4, y: 0, layer: "top", pointId: "power:end" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded_power",
        connection_name: "power",
        route: [
          {
            route_type: "wire",
            x: -4,
            y: 0,
            width: 0.15,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 4,
            y: 0,
            width: 0.15,
            layer: "top",
          },
        ],
      },
    ],
  }
  const problem = buildTypedRoutingProblem(
    compileRoutingRules({
      simpleRouteJson,
      routingRules: {
        layerStack: [
          { name: "top", zIndex: 0, preferredDirection: "horizontal" },
          { name: "bottom", zIndex: 1, preferredDirection: "vertical" },
        ],
        legalViaSpans: [{ fromLayer: "top", toLayer: "bottom" }],
        clearances: {
          traceToTraceMm: 0.15,
          traceToPadEdgeMm: 0.15,
          viaToTraceEdgeMm: 0.15,
          viaToPadEdgeMm: 0.15,
          boardEdgeMm: 0.15,
        },
        routingResolutionMm: 0.05,
        routeClasses: [
          {
            className: "power",
            traceWidthMm: 0.3,
            allowedLayers: ["top", "bottom"],
            viaBudget: { softMaximum: 2, hardMaximum: 4 },
          },
        ],
        connectionClassAssignments: [
          { connectionName: "power", className: "power" },
        ],
        preloadedCopperOwnership: [
          { pcbTraceId: "preloaded_power", mutability: "immutable" },
        ],
      },
    }),
  )

  const result = verifyFinalBoard({
    problem,
    copperSnapshot: buildInitialCopperSnapshot({ problem }),
    maximumViolationCount: 16,
  })

  expect(result.status).toBe("verified")
})
