import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createMultiRouteCrossing } from "tests/fixtures/crossing-via-reduction-multi-crossing-routes"
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes"

type RoutePoint = HighDensityRoute["route"][number]
type CrossingCase = {
  routes: HighDensityRoute[]
  routeIndex: number
  entryOffsetX: number
  multiCrossing: boolean
}

test("crossing candidate builders preserve coincident plated spans, terminals and width anchors", (): void => {
  const cases: CrossingCase[] = [
    {
      routes: createCrossingViaReductionRoutes(),
      routeIndex: 1,
      entryOffsetX: 1,
      multiCrossing: false,
    },
    {
      routes: createCrossingViaReductionRoutes(),
      routeIndex: 0,
      entryOffsetX: -1,
      multiCrossing: false,
    },
    {
      routes: createMultiRouteCrossing(),
      routeIndex: 1,
      entryOffsetX: 1,
      multiCrossing: true,
    },
  ]
  for (const crossingCase of cases) {
    const route: HighDensityRoute =
      crossingCase.routes[crossingCase.routeIndex]!
    const start: RoutePoint = route.route[0]!
    const end: RoutePoint = route.route.at(-1)!
    const entry: RoutePoint = {
      x: start.x + crossingCase.entryOffsetX,
      y: start.y,
      z: 1 - start.z,
    }
    route.route.unshift({ ...entry, y: entry.y + 1 }, entry, { ...entry })
    const coincidentTerminal: RoutePoint = {
      ...end,
      pcb_port_id: "other-end",
    }
    const widthAnchor: RoutePoint = {
      ...coincidentTerminal,
      traceThickness: 0.1,
    }
    route.route.push(coincidentTerminal, widthAnchor, { ...widthAnchor })
    const pad: Obstacle = {
      type: "rect",
      center: { x: (entry.x + start.x) / 2, y: start.y },
      width: 1.2,
      height: 0.4,
      layers: ["top", "bottom"],
      connectedTo: [route.connectionName],
      circuitJsonMetadata: { pcb_plated_hole_id: "shared-plated-span" },
    }
    const inputBefore: string = JSON.stringify({
      routes: crossingCase.routes,
      pad,
    })
    const connMap: ConnectivityMap = new ConnectivityMap({})
    const handoff: TraceSimplificationSolver = new TraceSimplificationSolver({
      hdRoutes: crossingCase.routes,
      obstacles: [pad],
      connMap,
      colorMap: {},
      layerCount: 2,
      defaultViaDiameter: 0.4,
    })
    const markedRoute: HighDensityRoute =
      handoff.hdRoutes[crossingCase.routeIndex]!
    expect(markedRoute.route[1]!.toNextSegmentType).toBeUndefined()
    expect(markedRoute.route[2]!.toNextSegmentType).toBe("through_obstacle")
    expect(markedRoute.route[2]!.toNextSegmentCircuitJsonMetadata).toEqual(
      pad.circuitJsonMetadata,
    )
    const markedInputBefore: string = JSON.stringify(handoff.hdRoutes)
    const originalViaCount: number = handoff.hdRoutes.flatMap(
      (hdRoute: HighDensityRoute): HighDensityRoute["vias"] => hdRoute.vias,
    ).length
    const solver: CrossingViaReductionSolver = new CrossingViaReductionSolver({
      inputHdRoutes: handoff.hdRoutes,
      obstacles: [pad],
      connMap,
      layerCount: 2,
    })

    expect((): void => solver.solve()).not.toThrow()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.stats.crossingViaReductions).toBe(1)
    expect(solver.stats.multiCrossingReductions ?? 0).toBe(
      crossingCase.multiCrossing ? 1 : 0,
    )
    const output: HighDensityRoute[] = solver.getReducedHdRoutes()
    expect(
      output.flatMap(
        (hdRoute: HighDensityRoute): HighDensityRoute["vias"] => hdRoute.vias,
      ),
    ).toHaveLength(originalViaCount - 2)
    const changedRoute: HighDensityRoute = output[crossingCase.routeIndex]!
    expect(changedRoute.route.slice(0, 4)).toEqual(
      markedRoute.route.slice(0, 4),
    )
    expect(changedRoute.route.slice(-3)).toEqual([
      end,
      coincidentTerminal,
      widthAnchor,
    ])
    expect(JSON.stringify(handoff.hdRoutes)).toBe(markedInputBefore)
    expect(JSON.stringify({ routes: crossingCase.routes, pad })).toBe(
      inputBefore,
    )
    for (const hdRoute of output) {
      for (
        let pointIndex: number = 1;
        pointIndex < hdRoute.route.length;
        pointIndex++
      ) {
        const previous: RoutePoint = hdRoute.route[pointIndex - 1]!
        const point: RoutePoint = hdRoute.route[pointIndex]!
        if (previous.z === point.z) continue
        if (previous.toNextSegmentType === "through_obstacle") {
          expect(previous.toNextSegmentCircuitJsonMetadata).toEqual(
            pad.circuitJsonMetadata,
          )
          continue
        }
        expect(point.x).toBe(previous.x)
        expect(point.y).toBe(previous.y)
        expect(hdRoute.vias).toContainEqual({ x: point.x, y: point.y })
      }
    }
  }
})
