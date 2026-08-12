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

const isInFocus = (point: { x: number; y: number }): boolean => {
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
  return circuitJson.flatMap((element) => {
    if (element.type === "pcb_trace") {
      const route = element.route.filter(
        (point) => "x" in point && "y" in point && isInFocus(point),
      )
      return route.length >= 2 ? [{ ...element, route }] : []
    }
    if (
      (element.type === "pcb_via" || element.type === "pcb_smtpad") &&
      isInFocus(element)
    ) {
      return [element]
    }
    return []
  })
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
  const focusedErrors = beforeFix.errors.filter(
    (error) =>
      error.type === "pcb_via_trace_clearance_error" &&
      "center" in error &&
      isInFocus(error.center),
  )
  const visualErrors = focusedErrors.map((error, index) => {
    const via = beforeFix.circuitJson.find(
      (element) =>
        element.type === "pcb_via" &&
        "pcb_via_id" in error &&
        element.pcb_via_id === error.pcb_via_id,
    )
    return {
      type: "pcb_trace_error",
      pcb_trace_error_id: `bugreport91_visual_error_${index}`,
      message: "0.083mm via-to-trace clearance; 0.1mm required",
      center: via && isInFocus(via) ? { x: via.x, y: via.y } : error.center,
    } as AnyCircuitElement
  })

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
