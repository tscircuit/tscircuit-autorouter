import { expect, test } from "bun:test"
import { createMultiResolutionSearchPlan } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/multi-resolution-router"
import type { HybridCoreSearchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/rust-core-protocol"

test("attempts every same-envelope strategy before activating a larger ring", () => {
  const request: HybridCoreSearchRequest = {
    protocolVersion: 1,
    regionId: "ring-test",
    bounds: { minX: -10, maxX: 10, minY: -8, maxY: 8 },
    activeBounds: { minX: -10, maxX: 10, minY: -8, maxY: 8 },
    activationBounds: [],
    layerNames: ["top", "bottom"],
    start: { x: -8, y: 0, layer: "top" },
    goal: { x: 8, y: 0, layer: "top" },
    legalViaSpans: [{ fromLayer: "top", toLayer: "bottom" }],
    obstacles: [],
    resolutionMm: 0.05,
    traceWidthMm: 0.15,
    clearanceMm: 0.15,
    viaPadDiameterMm: 0.4,
    maximumVias: 4,
    maximumExpansions: 10000,
    deterministicSeed: 17,
  }

  const plan = createMultiResolutionSearchPlan({
    baseRequest: request,
    maximumActivationRings: 3,
  })
  const coarse = plan.filter((entry) => entry.resolutionLevel === "coarse")

  expect(coarse.slice(0, 3).map((entry) => entry.strategy)).toEqual([
    "direct_bounded",
    "same_layer",
    "full_compatible",
  ])
  expect(coarse.slice(0, 3).every((entry) => entry.ringIndex === 0)).toBe(true)
  expect(coarse[3]?.ringIndex).toBe(1)
  expect(plan.filter((entry) => entry.resolutionLevel === "fine")[0]?.resolutionMm).toBe(
    request.resolutionMm,
  )
})
