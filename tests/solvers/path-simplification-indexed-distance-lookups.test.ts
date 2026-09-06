import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Point = HighDensityRoute["route"][number]
type Segment = {
  start: Point
  end: Point
  length: number
  startDistance: number
  endDistance: number
}
type DistanceLookupSolver = {
  pathSegments: Segment[]
  getSegmentIndexAtDistance: (distance: number) => number
  getPointAtDistance: (distance: number) => Point
  getNearestIndexForDistance: (distance: number) => number
}
type MeasuredOutput = { output: HighDensityRoute; reads: number }

const measureRoute = (
  inputRoute: HighDensityRoute,
  useLinearLookup: boolean,
): MeasuredOutput => {
  const solver: SingleSimplifiedPathSolver5 = new SingleSimplifiedPathSolver5(
    {
      inputRoute,
      otherHdRoutes: [],
      obstacles: [],
      connMap: new ConnectivityMap({}),
      colorMap: {},
    },
  )
  const lookup: DistanceLookupSolver =
    solver as unknown as DistanceLookupSolver
  let reads: number = 0
  lookup.pathSegments = new Proxy(lookup.pathSegments, {
    get(target: Segment[], property: string | symbol): unknown {
      if (typeof property === "string" && /^\d+$/.test(property)) reads++
      return Reflect.get(target, property)
    },
  })
  if (useLinearLookup) {
    lookup.getSegmentIndexAtDistance = (distance: number): number => {
      return lookup.pathSegments.findIndex(
        (segment: Segment): boolean =>
          distance >= segment.startDistance &&
          distance <= segment.endDistance,
      )
    }
  }
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  return { output: solver.simplifiedRoute, reads }
}

test("indexed distance lookups preserve inclusive copper boundaries without prefix scans", (): void => {
  const measured: Map<number, { indexed: number; linear: number }> = new Map()
  for (const segmentCount of [40, 80]) {
    const route: HighDensityRoute = {
      connectionName: "width-spans",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: Array.from(
        { length: segmentCount + 1 },
        (_, index: number): Point => ({
          x: (index * 10) / segmentCount,
          y: 0,
          z: 0,
          traceThickness: index % 2 === 0 ? 0.15 : 0.2,
        }),
      ),
      vias: [],
    }
    const indexed: MeasuredOutput = measureRoute(route, false)
    const linear: MeasuredOutput = measureRoute(route, true)
    expect(indexed.output).toEqual(linear.output)
    expect(indexed.output.route).toEqual(route.route)
    measured.set(segmentCount, {
      indexed: indexed.reads,
      linear: linear.reads,
    })
    const uniformRoute: HighDensityRoute = {
      ...route,
      route: route.route.map((point: Point): Point => ({
        ...point,
        traceThickness: 0.15,
      })),
    }
    expect(measureRoute(uniformRoute, false).output).toEqual(
      measureRoute(uniformRoute, true).output,
    )
  }
  expect(measured.get(80)!.indexed).toBeLessThan(measured.get(80)!.linear / 2)
  expect(measured.get(80)!.indexed).toBeLessThan(measured.get(40)!.indexed * 3)

  const boundaryRoutes: HighDensityRoute[] = [
    {
      connectionName: "zero-length-terminal-via",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "start" },
        { x: 0, y: 0, z: 1, pcb_port_id: "end" },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "via-boundaries",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, pcb_port_id: "start" },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 1, y: 0, z: 2, pcb_port_id: "end" },
      ],
      vias: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
    {
      connectionName: "plated-boundaries",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0, pcb_port_id: "start" },
        {
          x: 0,
          y: 0,
          z: 0,
          toNextSegmentType: "through_obstacle",
          toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "plated" },
        },
        { x: 0.2, y: 0, z: 1 },
        { x: 1, y: 0, z: 1, pcb_port_id: "end" },
      ],
      vias: [],
    },
  ]
  for (const route of boundaryRoutes) {
    expect(measureRoute(route, false).output).toEqual(
      measureRoute(route, true).output,
    )
    const solver: SingleSimplifiedPathSolver5 = new SingleSimplifiedPathSolver5(
      {
        inputRoute: route,
        otherHdRoutes: [],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
      },
    )
    const lookup: DistanceLookupSolver =
      solver as unknown as DistanceLookupSolver
    const totalDistance: number = lookup.pathSegments.at(-1)!.endDistance
    for (const segment of lookup.pathSegments) {
      for (const distance of [
        segment.startDistance,
        segment.endDistance,
        (segment.startDistance + segment.endDistance) / 2,
      ]) {
        const expectedIndex: number = lookup.pathSegments.findIndex(
          (candidate: Segment): boolean =>
            distance >= candidate.startDistance &&
            distance <= candidate.endDistance,
        )
        expect(lookup.getSegmentIndexAtDistance(distance)).toBe(expectedIndex)
        const expectedSegment: Segment = lookup.pathSegments[expectedIndex]!
        let expectedPoint: Point
        if (distance === totalDistance) {
          expectedPoint = route.route.at(-1)!
        } else if (distance === expectedSegment.startDistance) {
          expectedPoint = expectedSegment.start
        } else if (distance === expectedSegment.endDistance) {
          expectedPoint = expectedSegment.end
        } else {
          const factor: number =
            (distance - expectedSegment.startDistance) / expectedSegment.length
          expectedPoint = {
            x:
              expectedSegment.start.x +
              factor * (expectedSegment.end.x - expectedSegment.start.x),
            y:
              expectedSegment.start.y +
              factor * (expectedSegment.end.y - expectedSegment.start.y),
            z: factor < 0.5 ? expectedSegment.start.z : expectedSegment.end.z,
            traceThickness: expectedSegment.start.traceThickness,
          }
        }
        expect(lookup.getPointAtDistance(distance)).toEqual(expectedPoint)
        const midpoint: number =
          (expectedSegment.startDistance + expectedSegment.endDistance) / 2
        let expectedNearestIndex: number = expectedIndex
        if (distance <= 0) {
          expectedNearestIndex = 0
        } else if (distance >= totalDistance) {
          expectedNearestIndex = route.route.length - 1
        } else if (distance > midpoint) {
          expectedNearestIndex = expectedIndex + 1
        }
        expect(lookup.getNearestIndexForDistance(distance)).toBe(
          expectedNearestIndex,
        )
      }
    }
    expect(lookup.getPointAtDistance(-1)).toEqual(
      totalDistance === 0 ? route.route.at(-1) : route.route[0],
    )
    expect(lookup.getPointAtDistance(Infinity)).toEqual(route.route.at(-1))
    expect(lookup.getNearestIndexForDistance(-1)).toBe(0)
    expect(lookup.getNearestIndexForDistance(Infinity)).toBe(
      route.route.length - 1,
    )
  }
})
