import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

const input = {
  layerCount: 2,
  routingLayers: ["top"],
  minTraceWidth: 0.15,
  bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
  obstacles: [],
  connections: [],
  traces: [],
} satisfies SimpleRouteJson

test("power expansion fails clearly before adding vias on excluded layers", () => {
  expect(() => new PowerTraceExpansionSolver(input)).toThrow(
    "Power trace expansion cannot add vias when routingLayers excludes board layers",
  )
  expect(
    () => new PowerTraceExpansionSolver(input, { allowNewVias: true }),
  ).toThrow(
    "Power trace expansion cannot add vias when routingLayers excludes board layers",
  )
})
