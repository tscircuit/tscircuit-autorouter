import { expect, test } from "bun:test"
import {
  type Pipeline9HighDensitySeamSide,
  reversePipeline9HighDensitySeamRoutePoints,
  splitPipeline9HighDensitySeamRoute,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/splitPipeline9HighDensitySeamRoute"
import { getSharedEdgeForNodePair } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Pipeline9 seam splitting preserves directional widths and rejects ambiguous crossings", (): void => {
  const nodes: NodeWithPortPoints[] = [-1, 1].map((side) => ({
    capacityMeshNodeId: side < 0 ? "L" : "R",
    center: { x: side, y: 0 },
    width: 2,
    height: 4,
    availableZ: [0, 1],
    portPoints: [],
  }))
  const left: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "root-A",
    regionId: "L",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    startPcbPortId: "outer-left",
    route: [
      { x: -2, y: 0, z: 0, traceThickness: 0.25 },
      { x: -1, y: 0, z: 0, traceThickness: 0.15 },
      { x: 0, y: 0, z: 0 },
    ],
    vias: [],
  }
  const right: HighDensityRoute = {
    ...left,
    regionId: "R",
    startPcbPortId: "outer-right",
    route: [
      { x: 2, y: 0, z: 0, traceThickness: 0.3 },
      {
        x: 1.7,
        y: 0,
        z: 0,
        traceThickness: 0.2,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "span-pad" },
      },
      { x: 1.5, y: 0, z: 1, traceThickness: 0.18 },
      { x: 1.3, y: 0, z: 1, traceThickness: 0.16 },
      { x: 1.3, y: 0, z: 0, traceThickness: 0.12 },
      { x: 0, y: 0, z: 0 },
    ],
    vias: [{ x: 1.3, y: 0 }],
  }
  const reversed = reversePipeline9HighDensitySeamRoutePoints(right.route)
  expect(reversed.slice(0, -1).map((point) => point.traceThickness)).toEqual(
    right.route
      .slice(0, -1)
      .reverse()
      .map((point) => point.traceThickness),
  )
  expect(reversed[3]!.toNextSegmentType).toBe("through_obstacle")
  expect(reversed[3]!.toNextSegmentCircuitJsonMetadata).toEqual({
    pcb_plated_hole_id: "span-pad",
  })
  const sides: [Pipeline9HighDensitySeamSide, Pipeline9HighDensitySeamSide] = [
    { routeIndex: 3, route: left, node: nodes[0]!, reversed: false },
    { routeIndex: 7, route: right, node: nodes[1]!, reversed: true },
  ]
  const sharedEdge = getSharedEdgeForNodePair({
    nodeAId: "L",
    nodeBId: "R",
    nodeBounds: new Map([
      ["L", { minX: -2, maxX: 0, minY: -2, maxY: 2 }],
      ["R", { minX: 0, maxX: 2, minY: -2, maxY: 2 }],
    ]),
  })!
  const portPoint = {
    portPointId: "seam-A",
    connectionName: "A",
    x: 0,
    y: 0,
    z: 0,
  }
  const composite: HighDensityRoute = {
    ...left,
    route: [
      ...left.route.slice(0, -1),
      { ...reversed[0]!, y: -0.4 },
      ...reversed.slice(1),
    ],
    vias: right.vias,
  }
  const originalInputs = structuredClone({ composite, sides })
  const result = splitPipeline9HighDensitySeamRoute({
    candidateRoute: composite,
    sides,
    sharedEdge,
    portPoint,
    layerCount: 2,
  })
  expect(result).not.toBeNull()
  expect(result!.replacements.map((entry) => entry.routeIndex)).toEqual([3, 7])
  const outputRight = result!.replacements[1].route
  expect(outputRight.route.slice(0, -1)).toEqual(right.route.slice(0, -1))
  expect(outputRight.vias).toEqual(right.vias)
  expect(outputRight.startPcbPortId).toBe(right.startPcbPortId)
  expect(result!.replacements[0].route.route[0]).toEqual(left.route[0])
  expect(result!.replacements[0].route.route.at(-1)!.traceThickness).toBe(0.12)
  const leftOuter = left.route[0]!
  const rightOuter = right.route[0]!
  for (const invalid of [
    {
      name: "recrossing",
      route: [
        leftOuter,
        { x: 0.5, y: -0.4, z: 0 },
        { x: -0.5, y: -0.4, z: 0 },
        rightOuter,
      ],
      vias: [],
    },
    {
      name: "running along the edge",
      route: [
        leftOuter,
        { x: 0, y: -0.4, z: 0 },
        { x: 0, y: 0.4, z: 0 },
        rightOuter,
      ],
      vias: [],
    },
    {
      name: "a via on the seam",
      route: composite.route,
      vias: [{ x: 0, y: -0.4 }],
    },
    {
      name: "a protected PCB terminal at the crossing",
      route: [
        leftOuter,
        { x: 0, y: -0.4, z: 0, pcb_port_id: "do-not-move" },
        rightOuter,
      ],
      vias: [],
    },
    {
      name: "moving an outer endpoint within its node",
      route: [{ ...leftOuter, x: -1.9 }, ...composite.route.slice(1)],
      vias: composite.vias,
    },
    {
      name: "crossing beyond the shared edge",
      route: [leftOuter, { x: 0, y: 2.1, z: 0 }, rightOuter],
      vias: [],
    },
  ]) {
    expect(
      splitPipeline9HighDensitySeamRoute({
        candidateRoute: {
          ...composite,
          route: invalid.route,
          vias: invalid.vias,
        },
        sides,
        sharedEdge,
        portPoint,
        layerCount: 2,
      }),
      invalid.name,
    ).toBeNull()
  }
  expect({ composite, sides }).toEqual(originalInputs)
})
