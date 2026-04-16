import { test, expect } from "bun:test"
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import node from "../../fixtures/legacy/assets/cn11081-nodeWithPortPoints.json" with {
  type: "json",
}
import { createSrjFromNodeWithPortPoints } from "lib/utils/createSrjFromNodeWithPortPoints"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"

const nodeWithPortPoints = (node as any).nodeWithPortPoints

test("cn11081 single transition solver routes without DRC errors", () => {
  const srj = createSrjFromNodeWithPortPoints(nodeWithPortPoints)
  const solver = new HyperSingleIntraNodeSolver({
    nodeWithPortPoints,
    viaDiameter: 0.6,
  })

  expect(srj).toMatchInlineSnapshot(`
    {
      "bounds": {
        "maxX": -2.21875,
        "maxY": 11.09375,
        "minX": -4.4375,
        "minY": 8.875,
      },
      "connections": [
        {
          "name": "source_trace_76",
          "pointsToConnect": [
            {
              "layer": "top",
              "x": -2.21875,
              "y": 10.81640625,
            },
            {
              "layer": "bottom",
              "x": -2.21875,
              "y": 9.70703125,
            },
          ],
        },
        {
          "name": "source_net_0_mst22",
          "pointsToConnect": [
            {
              "layer": "top",
              "x": -2.21875,
              "y": 10.26171875,
            },
            {
              "layer": "top",
              "x": -3.328125,
              "y": 11.09375,
            },
          ],
        },
      ],
      "layerCount": 2,
      "minTraceWidth": 0.1,
      "obstacles": [],
    }
  `)

  solver.solve()

  expect(solver.solved).toBe(true)

  const solverName = solver.winningSolver?.constructor.name

  // Convert routes to circuit json and run DRC
  const circuitJson = convertToCircuitJson(
    srj,
    solver.solvedRoutes,
    srj.minTraceWidth,
  )
  const pcbTraces = circuitJson.filter(
    (
      element,
    ): element is (typeof circuitJson)[number] & {
      type: "pcb_trace"
      source_trace_id: string
    } => element.type === "pcb_trace",
  )
  const pcbVias = circuitJson.filter(
    (
      element,
    ): element is (typeof circuitJson)[number] & {
      type: "pcb_via"
    } => element.type === "pcb_via",
  )

  expect(pcbTraces).toHaveLength(2)
  expect(pcbVias.length).toBeGreaterThanOrEqual(1)
  expect(
    [...new Set(pcbTraces.map((trace) => trace.source_trace_id))].sort(),
  ).toEqual(["source_net_0_mst22", "source_trace_76"])
  const { errors } = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)

  expect(errors.length).toBe(0)
  expect(solverName).toMatchInlineSnapshot(`"CachedIntraNodeRouteSolver"`)
})
