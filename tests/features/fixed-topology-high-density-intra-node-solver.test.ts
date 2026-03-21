import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { createSrjFromNodeWithPortPoints } from "lib/utils/createSrjFromNodeWithPortPoints"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import input03 from "../../fixtures/features/via-high-density/via-high-density03-input.json" with {
  type: "json",
}
import { FixedTopologyHighDensityIntraNodeSolver } from "lib/solvers/FixedTopologyHighDensityIntraNodeSolver"
import type { SimplifiedPcbTrace } from "lib/types"

test("FixedTopologyHighDensityIntraNodeSolver test", () => {
  const solver = new FixedTopologyHighDensityIntraNodeSolver({
    nodeWithPortPoints: input03.nodeWithPortPoints as any,
    colorMap: input03.colorMap,
    traceWidth: input03.traceWidth,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(
    solver.solvedRoutes.every((route) => route.viaDiameter <= 0.3 + 1e-6),
  ).toBe(true)
  expect(
    solver
      .getOutputVias()
      .every((viaRegion) => viaRegion.diameter <= 0.3 + 1e-6),
  ).toBe(true)

  const srj = createSrjFromNodeWithPortPoints(input03.nodeWithPortPoints as any)

  const circuitJson = convertToCircuitJson(
    srj,
    solver.solvedRoutes,
    srj.minTraceWidth,
  )

  const hasBottomLayerTrace = circuitJson.some(
    (element) =>
      element.type === "pcb_trace" &&
      element.route.some(
        (segment) =>
          segment.route_type === "wire" && segment.layer === "bottom",
      ),
  )
  expect(hasBottomLayerTrace).toBe(true)
  expect(
    circuitJson
      .filter((element) => element.type === "pcb_via")
      .every((via) => via.outer_diameter <= 0.3 + 1e-6),
  ).toBe(true)

  const simplifiedTraces: SimplifiedPcbTrace[] = solver.solvedRoutes.map(
    (route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `fixed_topology_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    }),
  )
  const circuitJsonFromSimplified = convertToCircuitJson(
    srj,
    simplifiedTraces,
    srj.minTraceWidth,
  )
  expect(
    circuitJsonFromSimplified
      .filter((element) => element.type === "pcb_via")
      .every((via) => via.outer_diameter <= 0.3 + 1e-6),
  ).toBe(true)

  const pcbSvg = convertCircuitJsonToPcbSvg(circuitJson as AnyCircuitElement[])
  expect(pcbSvg).toMatchSvgSnapshot(import.meta.path)
})
