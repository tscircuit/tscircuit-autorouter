import { expect, test } from "bun:test"
import { buildSequentialSearchContext } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/sequential-search-context"
import type { HybridCopperSegment } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-types"
import type {
  HybridWorkerBoardContext,
  RegionSearchSpec,
} from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/worker-protocol"

test("exposes prior same-job copper as obstacles outside shared terminal windows", () => {
  const context: HybridWorkerBoardContext = {
    protocolVersion: 1,
    contextId: "board",
    boardContextVersion: 0,
    copperVersion: 0,
    boardBounds: { minX: -1, maxX: 11, minY: -1, maxY: 11 },
    layerNames: ["top", "bottom"],
    legalViaSpans: [{ fromLayer: "top", toLayer: "bottom" }],
    viaPadDiameterMm: 0.4,
    viaHoleDiameterMm: 0.2,
    allowViaInPad: false,
    clearanceMm: 0.1,
    geometry: [],
    connectionRules: [],
  }
  const priorSegment: HybridCopperSegment = {
    kind: "segment",
    copperId: "prior",
    connectionName: "power",
    layer: "top",
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    widthMm: 0.1,
    ownership: {
      mutability: "mutable",
      ownerRouteObjectIds: ["power:power"],
    },
  }
  const search: RegionSearchSpec = {
    searchId: "branch",
    connectionRuleReference: "power",
    start: { x: 0, y: 0, layer: "top" },
    goal: { x: 0, y: 10, layer: "top" },
    connectedTerminalIds: ["shared", "goal"],
    remainingViaBudget: 2,
  }
  const sequentialContext = buildSequentialSearchContext({
    context,
    addedTraces: [priorSegment],
    addedVias: [],
    search,
    traceWidthMm: 0.1,
    routingResolutionMm: 0.05,
  })
  const intraJobGeometry = sequentialContext.geometry[0]

  expect(intraJobGeometry?.connectedConnectionNames).toEqual([])
  expect(intraJobGeometry?.geometry.kind).toBe("segment")
  if (intraJobGeometry?.geometry.kind !== "segment") {
    throw new Error("expected clipped intra-job segment geometry")
  }
  expect(intraJobGeometry.geometry.startX).toBeCloseTo(0.3)
  expect(intraJobGeometry.geometry.endX).toBe(10)
})
