import { expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { getT113BootRoutingPcbSvg } from "../fixtures/getT113BootRoutingPcbSvg"
import { getT113BootRoutingResult } from "../fixtures/getT113BootRoutingResult"

test("Pipeline9 routes real T113-S3 SD connections around a boot fanout", async () => {
  const { circuitJson, srj, preloadedTraces, sdInput, sdSolver } =
    await getT113BootRoutingResult()
  expect(
    circuitJson
      .filter((element) => element.type === "source_component")
      .map((component) => component.name),
  ).toEqual([
    "U_SOC",
    "R_BOOT_SEL1",
    "R_SD0",
    "R_SD1",
    "R_SD2",
    "R_SD3",
    "R_SD4",
  ])
  expect(srj.obstacles).toHaveLength(141)
  expect(srj.connections).toHaveLength(7)
  expect(sdInput.connections).toHaveLength(5)
  for (const connection of sdInput.connections) {
    expect(connection.pointsToConnect).toHaveLength(2)
    expect(connection.pointsToConnect[0]).toMatchObject({
      port_selector: expect.stringMatching(/^U_SOC\./),
    })
    expect(connection.pointsToConnect[1]).toMatchObject({
      port_selector: expect.stringMatching(/^R_SD/),
    })
  }
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])
  expect(circuitJson).toContainEqual(
    expect.objectContaining({
      type: "pcb_copper_pour",
      layer: "bottom",
    }),
  )
  expect(preloadedTraces).toHaveLength(2)
  expect(sdInput.traces).toEqual(preloadedTraces)

  expect(sdSolver.failed).toBeFalse()
  expect(sdSolver.solved).toBeTrue()
  const traces = sdSolver.getOutputSimpleRouteJson().traces!
  expect(traces).toHaveLength(7)
  // Preserve the original boot-port metadata as well as the five SD links.
  // No continuity errors or clearance errors are excluded from this check.
  const drc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: sdSolver.srjWithPointPairs!,
    routedTraces: traces,
  })
  expect(drc.errors).toEqual([])
  const groundTrace = traces.find(
    (trace) => trace.connection_name === "source_trace_1",
  )!
  expect(groundTrace.route).not.toEqual(preloadedTraces[1]!.route)
  const vias = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(vias).toHaveLength(1)
  const via = vias[0]!
  expect(via).toMatchObject({
    from_layer: "top",
    to_layer: "bottom",
    via_diameter: 0.55,
    via_hole_diameter: 0.3,
  })
  for (const pad of srj.obstacles) {
    if (pad.connectedTo.includes(groundTrace.connection_name)) continue
    const clearance = pointToBoxDistance(via, pad) - via.via_diameter! / 2
    expect(clearance).toBeGreaterThanOrEqual(0.1 - 1e-9)
  }
  const groundPour = circuitJson.find(
    (element) => element.type === "pcb_copper_pour",
  )!
  expect(groundPour.shape).toBe("brep")
  if (groundPour.shape !== "brep") throw new Error("Expected a native pour")
  expect(groundPour.brep_shape.inner_rings).toHaveLength(0)
  expect(
    isPointInOrOnPolygon(via, groundPour.brep_shape.outer_ring.vertices),
  ).toBeTrue()
  expect(
    getT113BootRoutingPcbSvg({
      circuitJson,
      srj,
      traces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
