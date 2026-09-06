import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { StitchTerminal } from "lib/solvers/RouteStitchingSolver/getStitchTerminal"
import type { StitchSegment } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import { selectDirectedRouteStitchPath } from "lib/solvers/RouteStitchingSolver/selectDirectedRouteStitchPath"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("directed path clearance uses the unchanged native traversal's output width", (): void => {
  const start: StitchTerminal = {
    x: 0,
    y: 0,
    z: 0,
    pcb_port_id: "start-port",
  }
  const end: StitchTerminal = {
    x: 5,
    y: 0,
    z: 0,
    pcb_port_id: "end-port",
  }

  for (const nativeOutputIsNarrow of [true, false]) {
    const hdRoutes: HighDensityIntraNodeRoute[] = [
      {
        connectionName: "mixed-width-net",
        traceThickness: nativeOutputIsNarrow ? 0.6 : 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0.2, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "mixed-width-net",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 1.4, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName: "mixed-width-net",
        endPcbPortId: "end-port",
        traceThickness: nativeOutputIsNarrow ? 0.1 : 0.6,
        viaDiameter: 0.3,
        route: [
          { x: 3, y: 0, z: 0 },
          { x: 5, y: 0, z: 0 },
        ],
        vias: [],
      },
    ]
    const originalInput = structuredClone(hdRoutes)
    const isStitchSegmentClear = (segment: StitchSegment): boolean => {
      // This clearance corridor accepts the thin output but rejects the
      // thick output. The end-touching fragment establishes native direction,
      // even though the requested path is returned from start to end.
      const fitsCorridor = segment.traceThickness <= 0.2
      return fitsCorridor
    }
    const orderedRoutePath = selectDirectedRouteStitchPath({
      connectionName: "mixed-width-net",
      hdRoutes,
      start,
      end,
      isStitchSegmentClear,
    })
    if (!nativeOutputIsNarrow) {
      expect(orderedRoutePath).toBeNull()
      expect(hdRoutes).toEqual(originalInput)
      continue
    }

    expect(orderedRoutePath).not.toBeNull()
    expect(orderedRoutePath!.map((entry): string => entry.matchedOn)).toEqual([
      "first",
      "first",
      "first",
    ])
    const solver = new SingleHighDensityRouteStitchSolver3({
      connectionName: "mixed-width-net",
      hdRoutes: orderedRoutePath!.map(
        (entry): HighDensityIntraNodeRoute => entry.route,
      ),
      orderedRoutePath: orderedRoutePath!,
      start,
      end,
      isStitchSegmentClear,
      stitchClearanceMode: "require_clear",
      allowedLayerTransitionPointKeys: new Set<string>(),
      preserveTerminalPcbPortIds: true,
    })
    expect(solver.start).toEqual(end)
    expect(solver.end).toEqual(start)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.mergedHdRoute.traceThickness).toBe(0.1)
    expect(solver.mergedHdRoute.startPcbPortId).toBe("end-port")
    expect(solver.mergedHdRoute.endPcbPortId).toBe("start-port")
    expect(solver.mergedHdRoute.route).toEqual([
      { x: 5, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 1.4, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0.2, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ])
    expect(solver.mergedHdRoute.vias).toEqual([])
    expect(hdRoutes).toEqual(originalInput)
  }
})
