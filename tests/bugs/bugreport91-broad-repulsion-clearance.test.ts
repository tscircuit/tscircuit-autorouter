import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { AnyCircuitElement } from "circuit-json"
import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import fixtureJson from "../../fixtures/bugs/bugreport91-broad-repulsion-clearance/input.json" with {
  type: "json",
}

const fixture = fixtureJson as {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  buggyOutputHdRoutes: HighDensityRoute[]
}
const FOCUS_BOUNDS = { minX: 5.7, maxX: 7.35, minY: 3.35, maxY: 5.45 }
type Point2D = { x: number; y: number }

const getPoint = (value: unknown): Point2D | undefined => {
  if (!value || typeof value !== "object") return undefined
  const point = value as { x?: unknown; y?: unknown }
  if (typeof point.x !== "number" || typeof point.y !== "number") {
    return undefined
  }
  return { x: point.x, y: point.y }
}

const isInFocus = (point: Point2D): boolean => {
  return (
    point.x >= FOCUS_BOUNDS.minX &&
    point.x <= FOCUS_BOUNDS.maxX &&
    point.y >= FOCUS_BOUNDS.minY &&
    point.y <= FOCUS_BOUNDS.maxY
  )
}

const focusCircuitJson = (
  circuitJson: AnyCircuitElement[],
): AnyCircuitElement[] => {
  const focusedElements: AnyCircuitElement[] = []
  for (const element of circuitJson) {
    if (element.type === "pcb_trace") {
      const route = element.route.filter((routePoint) => {
        const point = getPoint(routePoint)
        return point !== undefined && isInFocus(point)
      })
      if (route.length >= 2) focusedElements.push({ ...element, route })
      continue
    }
    const point = getPoint(element)
    if (
      (element.type === "pcb_via" || element.type === "pcb_smtpad") &&
      point !== undefined &&
      isInFocus(point)
    ) {
      focusedElements.push(element)
    }
  }
  return focusedElements
}

const evaluateRoutes = (
  hdRoutes: HighDensityRoute[],
): ReturnType<typeof evaluateRelaxedDrc> => {
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.srj)
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: fixture.srj.connections,
    originalConnections: fixture.srj.connections,
    hdRoutes,
    layerCount: fixture.srj.layerCount,
    obstacles: fixture.srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  return evaluateRelaxedDrc({
    inputSrj: fixture.srj,
    srjWithPointPairs: fixture.srj,
    routedTraces,
  })
}

test("bugreport91 broad repulsion introduces a via-to-trace clearance error", () => {
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.srj)
  const outputHdRoutes = applyBroadRepulsionForces(
    fixture.srj as Parameters<typeof applyBroadRepulsionForces>[0],
    fixture.hdRoutes,
    1,
    3,
    connMap,
  )
  const { errors } = evaluateRoutes(outputHdRoutes)
  const viaTraceErrors = errors.filter(
    (error) => error.type === "pcb_via_trace_clearance_error",
  )
  const beforeFix = evaluateRoutes(fixture.buggyOutputHdRoutes)
  const focusedCircuitJson = focusCircuitJson(beforeFix.circuitJson)
  const focusedErrors = beforeFix.errors.filter((error) => {
    if (error.type !== "pcb_via_trace_clearance_error") return false
    const center = getPoint("center" in error ? error.center : undefined)
    return center !== undefined && isInFocus(center)
  })
  const visualErrors: AnyCircuitElement[] = []
  for (const [index, error] of focusedErrors.entries()) {
    const viaId = "pcb_via_id" in error ? error.pcb_via_id : undefined
    const via = beforeFix.circuitJson.find(
      (element) => element.type === "pcb_via" && element.pcb_via_id === viaId,
    )
    const viaPoint = getPoint(via)
    const errorCenter = getPoint("center" in error ? error.center : undefined)
    const center = viaPoint && isInFocus(viaPoint) ? viaPoint : errorCenter
    if (!center) continue
    visualErrors.push({
      type: "pcb_trace_error",
      pcb_trace_error_id: `bugreport91_visual_error_${index}`,
      message: "0.083mm via-to-trace clearance; 0.1mm required",
      center,
    } as AnyCircuitElement)
  }

  expect(viaTraceErrors).toHaveLength(1)
  expect(viaTraceErrors[0]).toMatchObject({ minimum_clearance: 0.1 })
  expect(viaTraceErrors[0]!.actual_clearance).toBeCloseTo(0.083, 3)
  expect(
    convertCircuitJsonToPcbSvg([...focusedCircuitJson, ...visualErrors], {
      backgroundColor: "white",
      shouldDrawErrors: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "before-fix-focused",
    tolerance: 0,
  })
})
