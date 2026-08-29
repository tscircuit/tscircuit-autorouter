import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { buildTypedRoutingProblem } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-typed-routing-problem"
import { compileRoutingRules } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/compile-routing-rules"
import { verifyFinalBoard } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/final-board-verifier"
import type { HybridRoutingRulesInput } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/types"

test("is the only fail-closed authority for a complete deterministic board", () => {
  const simpleRouteJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.4,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -4, y: 0, layer: "top", pointId: "signal:start" },
          { x: 4, y: 0, layer: "top", pointId: "signal:end" },
        ],
      },
    ],
  }
  const routingRules: HybridRoutingRulesInput = {
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
      boardEdgeMm: 0.2,
    },
    routingResolutionMm: 0.05,
    routeClasses: [
      {
        className: "signal",
        traceWidthMm: 0.15,
        allowedLayers: ["top", "bottom"],
        viaBudget: { softMaximum: 2, hardMaximum: 4 },
      },
    ],
    connectionClassAssignments: [
      { connectionName: "signal", className: "signal" },
    ],
  }
  const problem = buildTypedRoutingProblem(
    compileRoutingRules({ simpleRouteJson, routingRules }),
  )
  const completeSnapshot = {
    version: 1,
    segments: [
      {
        kind: "segment" as const,
        copperId: "signal:complete",
        connectionName: "signal",
        layer: "top",
        start: { x: -4, y: 0 },
        end: { x: 4, y: 0 },
        widthMm: 0.15,
        ownership: {
          mutability: "mutable" as const,
          ownerRouteObjectIds: ["signal:signal"],
        },
      },
    ],
    vias: [],
  }

  const first = verifyFinalBoard({
    problem,
    copperSnapshot: completeSnapshot,
    maximumViolationCount: 16,
  })
  const second = verifyFinalBoard({
    problem,
    copperSnapshot: completeSnapshot,
    maximumViolationCount: 16,
  })
  const incomplete = verifyFinalBoard({
    problem,
    copperSnapshot: { version: 0, segments: [], vias: [] },
    maximumViolationCount: 16,
  })

  expect(first.status).toBe("verified")
  expect(second.status).toBe("verified")
  if (first.status !== "verified" || second.status !== "verified") return
  expect(first.routeHash).toBe(second.routeHash)
  expect(incomplete.status).toBe("failed")
})
