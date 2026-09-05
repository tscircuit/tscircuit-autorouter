import { checkViaTraceClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import {
  applyDrcErrorForces,
  cloneRoutes,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

const viaRoute = (
  connectionName: string,
  rootConnectionName: string,
  x: number,
  y: number,
): HighDensityRoute => ({
  connectionName,
  rootConnectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: x - 1, y, z: 0 },
    { x, y, z: 0 },
    { x, y, z: 1 },
    { x: x + 1, y, z: 1 },
  ],
  vias: [{ x, y }],
})

test("clearance margin follows the owner's via transition after shared-site deduplication", (): void => {
  const routes: HighDensityRoute[] = [
    viaRoute("shared_a", "shared", 0, 0),
    viaRoute("shared_b", "shared", 0, 0.0005),
    viaRoute("target_owner", "target_owner", 3, 0),
    viaRoute("later_owner", "later_owner", 6, 0),
    {
      connectionName: "shared_signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0.28, z: 0 },
        { x: 1, y: 0.28, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "target_signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 2, y: 4.289, z: 0 },
        { x: 4, y: 4.289, z: 0 },
      ],
      vias: [],
    },
  ]
  // The target is the owner's second via, so owner identity alone is insufficient.
  routes[2]!.route.push(
    { x: 3, y: 4, z: 1 },
    { x: 3, y: 4, z: 0 },
    { x: 4, y: 4, z: 0 },
  )
  routes[2]!.vias.push({ x: 3, y: 4 })
  const srj = {
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  } satisfies SimpleRouteJson
  const getCircuitJson = (
    candidate: HighDensityRoute[],
  ): AnyCircuitElement[] => {
    const traces: SimplifiedPcbTrace[] = candidate.map((route) => ({
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_0`,
      connection_name: route.rootConnectionName ?? route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, 2),
    }))
    return convertToCircuitJson(srj, traces, { minViaDiameter: 0.3 })
  }
  const originalCircuitJson = getCircuitJson(routes)
  const mutable = cloneRoutes(routes)
  expect(
    applyDrcErrorForces(
      srj,
      mutable,
      [
        {
          type: "pcb_via_trace_clearance_error",
          pcb_trace_id: "shared_signal_0",
          pcb_trace_ids: ["shared_signal_0", "shared_a_0"],
          pcb_via_id: "via_0",
          pcb_via_ids: ["via_0"],
          minimum_clearance: 0.1,
          actual_clearance: 0.08,
          center: { x: 0, y: 0 },
        },
      ],
      new Map(
        routes.map((route, index) => [`${route.connectionName}_0`, index]),
      ),
      0.03,
      undefined,
      true,
      true,
      true,
      false,
    ),
  ).toBeTrue()
  for (const point of mutable[5]!.route) point.y = 4.2995
  const circuitJson = getCircuitJson(materializeRoutes(mutable))
  const originalVia = originalCircuitJson.find(
    (element) => element.type === "pcb_via" && element.pcb_via_id === "via_3",
  )!
  const renumberedVia = circuitJson.find(
    (element) => element.type === "pcb_via" && element.pcb_via_id === "via_3",
  )!
  expect(originalVia).toMatchObject({ pcb_trace_id: "target_owner_0", y: 4 })
  expect(renumberedVia).toMatchObject({ pcb_trace_id: "later_owner_0", y: 0 })
  const targets = [
    {
      type: "pcb_via_trace_clearance_error",
      pcb_trace_id: "target_signal_0",
      pcb_trace_ids: ["target_signal_0", "target_owner_0"],
      pcb_via_id: "via_3",
      pcb_via_ids: ["via_3"],
      minimum_clearance: 0.1,
      actual_clearance: 0.089,
    },
  ]
  const errors = getPipeline9ClearanceMarginErrors({
    circuitJson,
    originalCircuitJson,
    targets,
  })
  expect(errors).toHaveLength(1)
  expect(errors[0]!.actual_clearance).toBeCloseTo(0.0995, 10)
  expect(errors[0]!.pcb_via_id).toBe("via_2")
  expect(errors[0]!.pcb_via_ids).toEqual(["via_2"])
  expect(errors[0]!.center).toEqual({ x: 3, y: 4 })
  const relaxedErrors = checkViaTraceClearance(circuitJson, {
    minClearance: 0.1,
  })
  expect(
    relaxedErrors.some((error) => error.pcb_trace_id === "target_signal_0"),
  ).toBeFalse()

  for (const point of mutable[5]!.route) point.y = 4.312
  const clearedCircuitJson = getCircuitJson(materializeRoutes(mutable))
  expect(
    getPipeline9ClearanceMarginErrors({
      circuitJson: clearedCircuitJson,
      originalCircuitJson,
      targets,
    }),
  ).toHaveLength(0)

  // Opposite-direction events can retain a larger copper diameter at the same
  // site. Measuring the first converted via would overstate this clearance.
  const siteVia = clearedCircuitJson.find(
    (element) => element.type === "pcb_via" && element.pcb_via_id === "via_2",
  )!
  if (siteVia.type !== "pcb_via") throw new Error("Missing test via")
  clearedCircuitJson.push({
    ...siteVia,
    pcb_via_id: "larger_reverse_via",
    pcb_trace_id: "later_owner_0",
    outer_diameter: 0.36,
  })
  const largerViaErrors = getPipeline9ClearanceMarginErrors({
    circuitJson: clearedCircuitJson,
    originalCircuitJson,
    targets,
  })
  expect(largerViaErrors).toHaveLength(1)
  expect(largerViaErrors[0]!.actual_clearance).toBeCloseTo(0.082, 10)
  expect(largerViaErrors[0]!.pcb_via_id).toBe("larger_reverse_via")
  clearedCircuitJson.pop()

  const owner = clearedCircuitJson.find(
    (element) =>
      element.type === "pcb_trace" && element.pcb_trace_id === "target_owner_0",
  )!
  if (owner.type !== "pcb_trace") throw new Error("Missing test owner")
  owner.route = owner.route.filter((segment) => segment.route_type !== "via")
  expect(
    getPipeline9ClearanceMarginErrors({
      circuitJson: clearedCircuitJson,
      originalCircuitJson,
      targets,
    }),
  ).toEqual([{ type: "pipeline9_clearance_margin_identity_error" }])
})
