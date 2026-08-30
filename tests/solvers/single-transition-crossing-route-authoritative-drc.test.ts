import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("authoritative DRC still rejects real copper violations", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: 0, y: 5, layer: "top" },
          { x: 10, y: 5, layer: "top" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 5, y: 0, layer: "top" },
          { x: 5, y: 10, layer: "top" },
        ],
      },
    ],
  }
  const crossingRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "horizontal",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 5, z: 0 },
        { x: 10, y: 5, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "vertical",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 5, y: 0, z: 0 },
        { x: 5, y: 10, z: 0 },
      ],
      vias: [],
    },
  ]
  const circuitJson = [
    ...convertToCircuitJson(srj, crossingRoutes, {
      minTraceWidth: srj.minTraceWidth,
    }),
    createPcbBoardElement(srj),
  ]
  const { errors } = getDrcErrors(circuitJson)

  expect(errors.length).toBeGreaterThan(0)
  expect(
    errors.some(
      (error) =>
        error.error_type === "pcb_trace_error" &&
        error.message.includes("accidental contact"),
    ),
  ).toBe(true)
})
