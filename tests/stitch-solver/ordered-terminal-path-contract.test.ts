import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { StitchTerminal } from "lib/solvers/RouteStitchingSolver/getStitchTerminal"
import type { StitchSegment } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import type { OrderedRouteStitchEntry } from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("an ordered path preserves legacy terminal orientation and rejects a blocked planned gap", (): void => {
  const start: StitchTerminal = {
    x: 0,
    y: 0,
    z: 0,
    pcb_port_id: "start-port",
  }
  const end: StitchTerminal = {
    x: 0,
    y: 0.1,
    z: 0,
    pcb_port_id: "end-port",
  }
  const firstRoute: HighDensityIntraNodeRoute = {
    connectionName: "ordered-path-net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 2, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
    vias: [],
  }
  const secondRoute: HighDensityIntraNodeRoute = {
    connectionName: firstRoute.connectionName,
    startPcbPortId: "end-port",
    traceThickness: firstRoute.traceThickness,
    viaDiameter: firstRoute.viaDiameter,
    route: [
      { x: 0, y: 0.1, z: 0 },
      { x: 2, y: 0.2, z: 0 },
    ],
    vias: [],
  }
  const hdRoutes = [secondRoute, firstRoute]
  const orderedRoutePath: OrderedRouteStitchEntry[] = [
    { route: firstRoute, matchedOn: "last" },
    { route: secondRoute, matchedOn: "last" },
  ]
  const inputSnapshot = structuredClone({
    hdRoutes,
    orderedRoutePath,
    start,
    end,
  })

  // The fragment touching the end terminal establishes the legacy global
  // orientation. The selected plan must reverse both its entry order and
  // each matched endpoint, without mutating the caller's start-to-end plan.
  const unconstrained = new SingleHighDensityRouteStitchSolver3({
    connectionName: firstRoute.connectionName,
    hdRoutes,
    start,
    end,
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })
  expect(unconstrained.start.pcb_port_id).toBe("end-port")
  expect(unconstrained.end.pcb_port_id).toBe("start-port")

  for (const interiorGapIsClear of [true, false]) {
    const checkedSegments: StitchSegment[] = []
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: firstRoute.connectionName,
      hdRoutes,
      orderedRoutePath,
      start,
      end,
      allowedLayerTransitionPointKeys: new Set<string>(),
      preserveTerminalPcbPortIds: true,
      isStitchSegmentClear: (segment): boolean => {
        checkedSegments.push(structuredClone(segment))
        const isPlannedInteriorGap =
          segment.start.x === 2 &&
          segment.start.y === 0.2 &&
          segment.end.x === 2 &&
          segment.end.y === 0
        return interiorGapIsClear || !isPlannedInteriorGap
      },
      stitchClearanceMode: "require_clear",
    })
    expect(solver.start).toEqual(end)
    expect(solver.end).toEqual(start)
    solver.solve()

    expect(solver.solved).toBe(interiorGapIsClear)
    expect(solver.failed).toBe(!interiorGapIsClear)
    expect(solver.mergedHdRoute.startPcbPortId).toBe("end-port")
    expect(solver.mergedHdRoute.endPcbPortId).toBe("start-port")
    expect(solver.mergedHdRoute.vias).toEqual([])
    expect(checkedSegments).toHaveLength(interiorGapIsClear ? 2 : 1)
    expect(checkedSegments[0]).toEqual({
      connectionName: firstRoute.connectionName,
      start: { x: 2, y: 0.2, z: 0 },
      end: { x: 2, y: 0, z: 0 },
      traceThickness: firstRoute.traceThickness,
    })
    if (interiorGapIsClear) {
      expect(checkedSegments[1]).toEqual({
        connectionName: firstRoute.connectionName,
        start: { x: 0.5, y: 0, z: 0 },
        end: { x: 0, y: 0, z: 0 },
        traceThickness: firstRoute.traceThickness,
      })
      expect(solver.mergedHdRoute.route).toEqual([
        { x: 0, y: 0.1, z: 0 },
        { x: 2, y: 0.2, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ])
      expect(solver.remainingHdRoutes).toEqual([])
    } else {
      expect(solver.error).toContain("selected endpoint path")
      expect(solver.mergedHdRoute.route).toEqual([
        { x: 0, y: 0.1, z: 0 },
        { x: 2, y: 0.2, z: 0 },
      ])
      expect(solver.remainingHdRoutes).toHaveLength(1)
      expect(solver.remainingHdRoutes).toContain(firstRoute)
      expect(solver.remainingHdRoutes).not.toContain(secondRoute)
    }
    expect({ hdRoutes, orderedRoutePath, start, end }).toEqual(inputSnapshot)
    expect(orderedRoutePath[0]!.route).toBe(firstRoute)
    expect(orderedRoutePath[1]!.route).toBe(secondRoute)
  }
})
