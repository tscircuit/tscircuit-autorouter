import { expect, test } from "bun:test"
import { pinPipeline9PreloadedSectionEndpoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pinPipeline9PreloadedSectionEndpoints"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { reverseRoutePoints } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { createPreloadedSeamFixture } from "../fixtures/pipeline9-preloaded-seam-fixture"

test("strict stitching retains original span width in both orientations beside a wider mutable route", (): void => {
  for (const reversed of [false, true]) {
    const input = createPreloadedSeamFixture(true)
    if (reversed) {
      input.sections[0]!.connection.pointsToConnect.reverse()
      const section = input.sections[0]!
      const start = section.startRoutePosition
      section.startRoutePosition = section.endRoutePosition
      section.endRoutePosition = start
      for (const witness of input.witnesses) witness.endpointIndex = witness.endpointIndex === 0 ? 1 : 0
    }
    const pins = pinPipeline9PreloadedSectionEndpoints(input)
    const solver = new MultipleHighDensityRouteStitchSolver3({
      connections: [input.sections[0]!.connection], layerCount: 2, useDeclaredConnectionEndpoints: true,
      hdRoutes: [...pins.ownedConnectors, {
        connectionName: "mutable", rootConnectionName: input.witnesses[0]!.rootConnectionName,
        traceThickness: 0.2, viaDiameter: 0.3,
        route: [{ x: -1, y: -1, z: 0 }, { x: 0, y: 0, z: 0 }], vias: [],
      }],
    })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    const route = solver.mergedHdRoutes[0]!
    const exported = convertHdRouteToSimplifiedRoute(route, 2)
    for (let index = 0; index < route.route.length - 1; index++) {
      const point = route.route[index]!
      const next = route.route[index + 1]!
      if (point.x === next.x && point.y === next.y) continue
      const ownedSpan = Math.min(point.x, next.x) >= 0
      expect(point.traceThickness ?? route.traceThickness).toBe(ownedSpan ? 0.1 : 0.2)
      const wire = exported.find((entry) => entry.route_type === "wire" && entry.x === point.x && entry.y === point.y)
      expect(wire).toMatchObject({ width: ownedSpan ? 0.1 : 0.2 })
    }
  }
  const reversed = reverseRoutePoints([
    { x: 0, y: 0, z: 0, traceThickness: 0.1, toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: { pcb_smtpad_id: "protected" } },
    { x: 1, y: 0, z: 0, traceThickness: 0.2 }, { x: 2, y: 0, z: 0, traceThickness: 0.3 },
  ])
  expect(reversed[0]!.traceThickness).toBe(0.2)
  expect(reversed[1]).toMatchObject({ traceThickness: 0.1, toNextSegmentType: "through_obstacle", toNextSegmentCircuitJsonMetadata: { pcb_smtpad_id: "protected" } })
})
