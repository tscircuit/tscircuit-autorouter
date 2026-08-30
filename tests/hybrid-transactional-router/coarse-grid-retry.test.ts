import { expect, test } from "bun:test"
import { runMultiResolutionSearch } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/multi-resolution-router"
import type {
  HybridCoreSearchRequest,
  HybridCoreSearchResponse,
  HybridRoutingCoreRuntime,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/rust-core-protocol"

test("continues to a legal fine grid after coarse endpoint snaps fail", async () => {
  const attemptedResolutions: number[] = []
  const runtime: HybridRoutingCoreRuntime = {
    target: "native",
    async execute(
      request: HybridCoreSearchRequest,
    ): Promise<HybridCoreSearchResponse> {
      attemptedResolutions.push(request.resolutionMm)
      const work = {
        searchExpansions: 1,
        spatialIndexQueries: 1,
        geometryPredicateCalls: 1,
        generatedNeighbors: 1,
        peakOpenSetSize: 1,
        activatedRings: 0,
      }
      if (request.resolutionMm > 0.1) {
        return {
          status: "failed",
          protocolVersion: 2,
          regionId: request.regionId,
          code: "no_legal_path",
          message: "coarse terminal snap is obstructed",
          work,
        }
      }
      return {
        status: "solved",
        protocolVersion: 2,
        regionId: request.regionId,
        route: [request.start, request.goal],
        vias: [],
        cost: { viaCount: 0, totalLengthMm: 2, bendCount: 0 },
        work,
      }
    },
  }
  const baseRequest: HybridCoreSearchRequest = {
    protocolVersion: 2,
    regionId: "coarse-retry",
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    activeBounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    activationBounds: [],
    layerNames: ["top", "bottom"],
    start: { x: -1, y: 0, layer: "top" },
    goal: { x: 1, y: 0, layer: "top" },
    legalViaSpans: [{ fromLayer: "top", toLayer: "bottom" }],
    obstacles: [],
    viaForbiddenObstacles: [],
    resolutionMm: 0.05,
    traceWidthMm: 0.15,
    clearanceMm: 0.1,
    viaPadDiameterMm: 0.4,
    maximumVias: 2,
    maximumExpansions: 1000,
    deterministicSeed: 17,
  }

  const result = await runMultiResolutionSearch({
    runtime,
    baseRequest,
    maximumActivationRings: 1,
  })

  expect(result.status).toBe("solved")
  expect(attemptedResolutions).toEqual([0.2, 0.2, 0.2, 0.1, 0.05])
  if (result.status !== "solved") return
  expect(result.response.regionId).toContain(":fine:")
})
