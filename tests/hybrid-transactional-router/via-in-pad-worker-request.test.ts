import { expect, test } from "bun:test"
import { buildWorkerCoreSearchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/build-worker-core-request"
import type {
  HybridWorkerBoardContext,
  RegionJob,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/worker-protocol"

test("sends connected pads to the via-only forbidden geometry index", () => {
  const context: HybridWorkerBoardContext = {
    protocolVersion: 1,
    contextId: "board",
    boardContextVersion: 0,
    copperVersion: 0,
    boardBounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerNames: ["top", "bottom"],
    legalViaSpans: [{ fromLayer: "top", toLayer: "bottom" }],
    viaPadDiameterMm: 0.4,
    viaHoleDiameterMm: 0.2,
    allowViaInPad: false,
    clearanceMm: 0.15,
    geometry: [
      {
        sourceKind: "obstacle",
        geometry: {
          kind: "rotated_rect",
          geometryId: "connected-pad",
          layer: "top",
          centerX: -4,
          centerY: 0,
          widthMm: 0.8,
          heightMm: 0.8,
          rotationDegrees: 0,
        },
        connectedConnectionNames: ["signal"],
      },
      {
        sourceKind: "copper",
        geometry: {
          kind: "segment",
          geometryId: "connected-copper",
          layer: "top",
          startX: -4,
          startY: 0,
          endX: -3,
          endY: 0,
          widthMm: 0.15,
        },
        connectedConnectionNames: ["signal"],
      },
      {
        sourceKind: "obstacle",
        geometry: {
          kind: "rotated_rect",
          geometryId: "foreign-pad",
          layer: "top",
          centerX: 0,
          centerY: 0,
          widthMm: 0.8,
          heightMm: 0.8,
          rotationDegrees: 0,
        },
        connectedConnectionNames: ["other"],
      },
    ],
    connectionRules: [],
  }
  const job: RegionJob = {
    protocolVersion: 1,
    jobId: "job",
    regionId: "region",
    transactionId: "transaction",
    ownerRouteObjectId: "signal:signal",
    boardContextVersion: 0,
    copperVersion: 0,
    boundaryContractVersion: 0,
    bounds: context.boardBounds,
    envelope: context.boardBounds,
    terminalReferences: [],
    boundaryContractReferences: [],
    ownedPreloadedCopperReferences: [],
    searches: [],
    coupling: { kind: "independent" },
    solverBudget: { maximumExpansions: 1000, maximumActivationRings: 1 },
    routingResolutionMm: 0.05,
    deterministicSeed: 17,
    congestionCost: 0,
    diagnostic: {
      code: "test",
      message: "test",
      regionIds: ["region"],
      connectionNames: ["signal"],
    },
  }

  const request = buildWorkerCoreSearchRequest({
    context,
    job,
    searchIdentity: "signal",
    start: { x: -4, y: 0, layer: "top" },
    goal: { x: 4, y: 0, layer: "top" },
    allowedLayers: ["top", "bottom"],
    traceWidthMm: 0.15,
    maximumVias: 2,
    connectedConnectionNames: ["signal"],
  })

  expect(request.obstacles.map((item) => item.geometryId)).toEqual([
    "foreign-pad",
  ])
  expect(
    request.viaForbiddenObstacles.map((item) => item.geometryId),
  ).toEqual(["connected-pad"])
})
