import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { stackSvgsHorizontally } from "stack-svgs"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixture from "../fixtures/srj18-sample16-partial-repair.json"

type SnapshotRegion = {
  name: string
  title: string
  center: { x: number; y: number }
  width: number
  height: number
}

const renderPcbCloseup = (
  circuitJson: AnyCircuitElement[],
  region: SnapshotRegion,
  title: string,
): string => {
  const { bounds } = fixture.srj
  const scale = 100
  const svg = convertCircuitJsonToPcbSvg([
    ...circuitJson,
    createPcbBoardElement(fixture.srj as SimpleRouteJson),
  ], {
    width: (bounds.maxX - bounds.minX) * scale,
    height: (bounds.maxY - bounds.minY) * scale,
    drawPaddingOutsideBoard: false,
    includeVersion: false,
    renderSolderMask: false,
    shouldDrawErrors: false,
  })
  // Crop the renderer's unchanged board coordinates; both states use the
  // same viewport so changes in copper position cannot be hidden by autofit.
  const x = (region.center.x - region.width / 2 - bounds.minX) * scale
  const y = (bounds.maxY - region.center.y - region.height / 2) * scale
  const cropped = svg.replace(
    /<svg\b[^>]*>/,
    `<svg x="0" y="48" width="560" height="400" viewBox="${x} ${y} ${region.width * scale} ${region.height * scale}" overflow="hidden" xmlns="http://www.w3.org/2000/svg">`,
  )
  return `<svg width="560" height="448" viewBox="0 0 560 448" xmlns="http://www.w3.org/2000/svg"><rect width="560" height="448" fill="#111"/><text x="16" y="29" fill="white" font-family="sans-serif" font-size="18">${title}</text>${cropped}</svg>`
}

test("publishes the SRJ18 repairs while the imported C43 pad still covers TP5", async (): Promise<void> => {
  // Five unchanged routes and their pad/net context from the video's final
  // sample16 output on d1e664f, before the dataset's trapezoid conversion fix.
  const originalSrj = fixture.srj as SimpleRouteJson
  const routes = structuredClone(fixture.routes) as HighDensityRoute[]
  const original = structuredClone(routes)
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const evaluateRoutes = (candidate: HighDensityRoute[]): ReturnType<typeof evaluateRelaxedDrc> => {
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: candidate,
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap,
      }),
    })
  }
  const drcEvaluator: DrcEvaluator = ({ routes: candidate }): ReturnType<DrcEvaluator> => {
    if (!candidate) throw new Error("Missing candidate routes")
    const evaluation = evaluateRoutes(candidate)
    return {
      errors: evaluation.errors,
      errorsWithCenters: evaluation.errorsWithCenters,
    } as unknown as ReturnType<DrcEvaluator>
  }
  const result = applyPipeline9BoundedRegionalRepairs({
    originalSrj,
    routes,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    viaHoleDiameter: 0.15,
  })
  const before = evaluateRoutes(original)
  const after = evaluateRoutes(result.routes)
  const errors = after.errors
  expect(result.initialDrcIssueCount).toBe(4)
  expect(errors).toHaveLength(2)
  expect(errors.map((error) =>
    error.type === "pcb_trace_error" ? error.pcb_trace_error_id : error.type,
  ).sort()).toEqual([
    "overlap_source_trace_15__source_net_15_mst4_0_pcb_smtpad_62",
    "overlap_source_trace_15__source_net_15_mst6_0_pcb_smtpad_62",
  ])
  expect(result.publishedDrcIssueCount).toBe(2)
  expect(result.repaired).toBeFalse()
  expect(result.routes).not.toBe(routes)
  expect(routes).toEqual(original)
  for (const [index, route] of result.routes.entries()) {
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    expect(route.traceThickness).toBe(original[index]!.traceThickness)
  }
  const regions: SnapshotRegion[] = [
    { name: "via-inner2", title: "Via / inner2 trace", center: { x: -5.05, y: 14.25 }, width: 1.5, height: 1.07 },
    { name: "u2-pad-clearance", title: "U2 pad clearance", center: { x: 5.65, y: 1.72 }, width: 1.5, height: 1.07 },
    { name: "c43-tp5-unresolved", title: "C43 / TP5 input overlap remains", center: { x: -1.8, y: -5.1 }, width: 2.8, height: 2 },
  ]
  for (const region of regions) {
    await expect(stackSvgsHorizontally([
      renderPcbCloseup(before.circuitJson, region, `Before: ${region.title}`),
      renderPcbCloseup(after.circuitJson, region, `After: ${region.title}`),
    ])).toMatchSvgSnapshot(import.meta.path, {
      svgName: region.name,
      tolerance: 0,
    })
  }
})
