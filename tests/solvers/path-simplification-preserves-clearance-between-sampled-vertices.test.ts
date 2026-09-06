import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("path simplification preserves copper clearance when sampling passes nearby vertices", (): void => {
  const via: { x: number; y: number } = { x: 0, y: 0 }
  const traceThickness: number = 0.1
  const viaDiameter: number = 0.3
  const requiredSeparation: number = traceThickness / 2 + viaDiameter / 2 + 0.1
  // Each chord clears the via by 0.11mm. Skipping polygon vertices would
  // cut inside that clearance even though every original segment is valid.
  const radius: number = 0.31 / Math.cos(Math.PI / 16)
  const orientations: Array<[rotation: number, reverse: boolean]> = [
    [0, false],
    [0, true],
    [Math.PI / 6, false],
    [Math.PI / 6, true],
    [Math.PI / 2, false],
    [Math.PI / 2, true],
    [Math.PI, false],
    [Math.PI, true],
  ]
  const coordinates: Array<{ x: number; y: number }> = [
    { x: -1, y: 0 },
    ...Array.from({ length: 9 }, (_, index): { x: number; y: number } => {
      const angle: number = Math.PI - (index * Math.PI) / 8
      return {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      }
    }),
    { x: 1, y: 0 },
  ]
  for (const [rotation, reverse] of orientations) {
    const points: RoutePoint[] = coordinates.map(
      ({ x, y }): RoutePoint => ({
        x: x * Math.cos(rotation) - y * Math.sin(rotation),
        y: x * Math.sin(rotation) + y * Math.cos(rotation),
        z: 0,
        traceThickness,
      }),
    )
    if (reverse) points.reverse()
    points[0]!.pcb_port_id = "start_port"
    points[points.length - 1]!.pcb_port_id = "end_port"
    const route: HighDensityRoute = {
      connectionName: "wire_around_via",
      rootConnectionName: "wire_net",
      startPcbPortId: "start_port",
      endPcbPortId: "end_port",
      traceThickness,
      viaDiameter,
      route: points,
      vias: [],
    }
    const foreignRoute: HighDensityRoute = {
      connectionName: "foreign_via",
      traceThickness,
      viaDiameter,
      route: [
        { ...via, z: 0 },
        { ...via, z: 1 },
      ],
      vias: [via],
    }
    const inputSnapshot: HighDensityRoute[] = structuredClone([
      route,
      foreignRoute,
    ])
    for (let index: number = 1; index < points.length; index++) {
      expect(
        pointToSegmentDistance(via, points[index - 1]!, points[index]!),
      ).toBeGreaterThanOrEqual(requiredSeparation)
    }
    const solver: SingleSimplifiedPathSolver5 = new SingleSimplifiedPathSolver5(
      {
        inputRoute: route,
        otherHdRoutes: [foreignRoute],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
        useTraceWidthAwareClearance: true,
      },
    )
    solver.solve()
    const output: HighDensityRoute = solver.simplifiedRoute
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(output.route[0]).toEqual(points[0])
    expect(output.route.at(-1)).toEqual(points.at(-1))
    expect(output.startPcbPortId).toBe(route.startPcbPortId)
    expect(output.endPcbPortId).toBe(route.endPcbPortId)
    expect(output.vias).toEqual([])
    expect([route, foreignRoute]).toEqual(inputSnapshot)
    for (let index: number = 1; index < output.route.length; index++) {
      const previous: RoutePoint = output.route[index - 1]!
      const current: RoutePoint = output.route[index]!
      expect(current.z).toBe(previous.z)
      expect(current.traceThickness).toBe(traceThickness)
      expect(
        pointToSegmentDistance(via, previous, current),
      ).toBeGreaterThanOrEqual(requiredSeparation)
    }
  }
})
