import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/repairTypes"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import type { CorridorPathInput } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createVisibilityCorridorSearch"

function findClearancePath(input: CorridorPathInput): ReturnType<FindClearancePathSolver["getOutput"]> {
  const solver = new FindClearancePathSolver(input)
  while (!solver.solved && !solver.failed) solver.step()
  if (solver.failed) throw new Error(`Corridor search failed: ${solver.error}`)
  const output = solver.getOutput()
  expect(solver.stats.nodesPopped).toBeLessThan(100)
  return output
}

test("paths respect the rectangular pad envelope used by candidate scoring", (): void => {
  const start = { x: -1, y: 0, z: 0 }
  const end = { x: 1, y: 0, z: 0 }
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [start, end],
    vias: [],
  }
  const srj: SimpleRouteJson = {
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    layerCount: 2,
    minTraceWidth: 0.1,
    connections: [{ name: "signal", pointsToConnect: [] }],
    obstacles: [
      {
        type: "oval",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["foreign"],
      },
    ],
  }
  const input = {
    srj,
    routes: [route],
    routeIndex: 0,
    start,
    end,
    bounds: srj.bounds,
    traceThickness: 0.1,
    traceClearance: 0.1,
    viaClearance: 0.1,
    allowLayerChanges: false,
  }
  const output = findClearancePath(input)
  expect(output).not.toBeNull()
  expect(output![0]).toEqual(start)
  expect(output!.at(-1)).toEqual(end)
  for (let index = 1; index < output!.length; index++) {
    expect(output![index]!.z).toBe(0)
    expect(
      segmentToBoundsMinDistance(output![index - 1]!, output![index]!, {
        minX: -0.2,
        maxX: 0.2,
        minY: -0.2,
        maxY: 0.2,
      }) - 0.05,
    ).toBeGreaterThanOrEqual(0.1 - 1e-8)
  }
  // This point clears the circle but starts inside its required envelope.
  expect(
    findClearancePath({ ...input, start: { x: 0.25, y: 0.25, z: 0 } }),
  ).toBeNull()
})
