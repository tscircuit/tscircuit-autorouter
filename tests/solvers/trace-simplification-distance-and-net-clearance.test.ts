import { expect, test } from "bun:test"
import {
  TraceSimplificationSolver,
  type HighDensityRoute,
  type Obstacle,
} from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { minimumDistanceBetweenSegments } from "../../node_modules/@tscircuit/trace-simplification-solver/lib/utils/minimumDistanceBetweenSegments"

type Point = { x: number; y: number }
type DistanceCase = {
  first: [Point, Point]
  second: [Point, Point]
  expected: number
}

test("trace simplification preserves exact distances and same-net obstacle decisions", (): void => {
  const distanceCases: DistanceCase[] = [
    { first: [{ x: 0, y: 0 }, { x: 4, y: 0 }], second: [{ x: 1, y: 3 }, { x: 3, y: 3 }], expected: 3 },
    { first: [{ x: 0, y: 0 }, { x: 4, y: 0 }], second: [{ x: 2, y: 2 }, { x: 3, y: 3 }], expected: 2 },
    { first: [{ x: 0, y: 0 }, { x: 2, y: 2 }], second: [{ x: 1, y: -1 }, { x: 3, y: 1 }], expected: Math.SQRT2 },
    { first: [{ x: 0, y: 0 }, { x: 1, y: 0 }], second: [{ x: 4, y: 4 }, { x: 4, y: 7 }], expected: 5 },
    { first: [{ x: 0, y: 0 }, { x: 0, y: 0 }], second: [{ x: 3, y: 4 }, { x: 3, y: 4 }], expected: 5 },
    { first: [{ x: 0, y: 3 }, { x: 0, y: 3 }], second: [{ x: -2, y: 0 }, { x: 2, y: 0 }], expected: 3 },
    { first: [{ x: 0, y: 0 }, { x: 2, y: 2 }], second: [{ x: 0, y: 2 }, { x: 2, y: 0 }], expected: 0 },
    { first: [{ x: 0, y: 0 }, { x: 2, y: 0 }], second: [{ x: 1, y: 0 }, { x: 3, y: 0 }], expected: 0 },
    { first: [{ x: 1, y: 0 }, { x: 1, y: 0 }], second: [{ x: 0, y: 0 }, { x: 2, y: 0 }], expected: 0 },
  ]
  for (const { first, second, expected } of distanceCases) {
    expect(minimumDistanceBetweenSegments(...first, ...second)).toBe(expected)
    expect(minimumDistanceBetweenSegments(...second, ...first)).toBe(expected)
    expect(minimumDistanceBetweenSegments(first[1], first[0], second[1], second[0])).toBe(expected)
  }

  const route: HighDensityRoute = {
    connectionName: "editable",
    rootConnectionName: "root-net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
      { x: 2, y: 0, z: 1 }, { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 1 },
      { x: 6, y: 0, z: 1 }, { x: 6, y: 0, z: 0 },
      { x: 8, y: 0, z: 0 }, { x: 8, y: 0, z: 1 },
      { x: 10, y: 0, z: 1 }, { x: 10, y: 0, z: 0 },
    ],
    vias: [0, 2, 4, 6, 8, 10].map((x) => ({ x, y: 0 })),
  }
  const obstacleCases = [
    { x: 0, connectedTo: ["unconnected"], layers: ["top", "bottom"], id: "wrong-net" },
    { x: 0, connectedTo: ["editable"], layers: ["top"], id: "single-layer" },
    { x: 0, connectedTo: ["editable"], layers: ["top", "bottom"], id: "direct" },
    { x: 0, connectedTo: ["editable"], layers: ["top", "bottom"], id: "later-match" },
    { x: 2, connectedTo: ["root-net"], layers: ["top", "bottom"], id: "root" },
    { x: 4, connectedTo: ["pad-by-connection"], layers: ["top", "bottom"], id: "connected" },
    { x: 6, connectedTo: ["pad-by-root"], layers: ["top", "bottom"], id: "root-connected" },
    { x: 8, connectedTo: ["editable"], layers: ["top"], id: "unplated" },
    { x: 10, connectedTo: ["unconnected"], layers: ["top", "bottom"], id: "foreign" },
    { x: 100, connectedTo: ["editable"], layers: ["top", "bottom"], id: "distant" },
  ]
  const obstacles: Obstacle[] = obstacleCases.map(({ x, connectedTo, layers, id }) => ({
    type: "rect",
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layers,
    connectedTo,
    circuitJsonMetadata: { pcb_plated_hole_id: id },
  }))
  const solver = new TraceSimplificationSolver({
    hdRoutes: [route],
    obstacles,
    connMap: new ConnectivityMap({
      connectionNet: ["editable", "pad-by-connection"],
      rootNet: ["root-net", "pad-by-root"],
    }),
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  })

  const markedRoute = solver.simplifiedHdRoutes[0]!
  expect(markedRoute.vias).toEqual([{ x: 8, y: 0 }, { x: 10, y: 0 }])
  expect(markedRoute.route.filter((point) => point.toNextSegmentType === "through_obstacle").map((point) => point.toNextSegmentCircuitJsonMetadata?.pcb_plated_hole_id)).toEqual(["direct", "root", "connected", "root-connected"])
  expect(markedRoute.route[8]!.toNextSegmentType).toBeUndefined()
  expect(markedRoute.route[10]!.toNextSegmentType).toBeUndefined()
  expect(route.vias).toHaveLength(6)
  expect(route.route.every((point) => point.toNextSegmentType === undefined)).toBeTrue()
})
