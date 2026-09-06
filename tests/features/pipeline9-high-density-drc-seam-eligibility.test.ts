import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getPipeline9HighDensitySeamForceCandidates,
  type Pipeline9HighDensitySeamForceCandidateParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensitySeamForceCandidates"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 seam forces require an unbranched owned handoff", (): void => {
  const seam: PortPoint = {
    portPointId: "seam-A",
    connectionName: "A",
    x: 0,
    y: 0,
    z: 0,
  }
  const nodes: NodeWithPortPoints[] = [-1, 1].map((side) => {
    const outer = {
      ...seam,
      portPointId: `outer-${side}`,
      pcb_port_id: `port-${side}`,
      x: side * 2,
    }
    return {
      capacityMeshNodeId: side < 0 ? "L" : "R",
      center: { x: side, y: 0 },
      width: 2,
      height: 4,
      availableZ: [0, 1],
      portPoints: [outer, { ...seam }],
      portPointsInPairs: [[outer, { ...seam }]],
    }
  })
  const routes: HighDensityRoute[] = [-1, 1].map((side) => ({
    connectionName: "A",
    rootConnectionName: "A",
    regionId: side < 0 ? "L" : "R",
    startPcbPortId: `port-${side}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [2, 0.5, 0].map((x) => ({ x: side * x, y: 0, z: 0 })),
    vias: [],
  }))
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 0, y: 0.27 },
      width: 0.4,
      height: 0.4,
      layers: ["top"],
      connectedTo: ["B"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad-b" },
    },
  ]
  const params: Pipeline9HighDensitySeamForceCandidateParams = {
    affectedRouteIndex: 0,
    nodePortPoints: nodes,
    hdRoutes: routes,
    forceContext: {
      connMap: new ConnectivityMap({
        A: ["A", "A_0", "A_1", "port--1", "port-1"],
        B: ["B", "pad-b"],
      }),
      obstacles: obstacles.map((obstacle) => ({
        ...obstacle,
        connectedTo: ["pad-b"],
      })),
    },
    fixedHdRoutes: [],
    traceRouteIndexById: new Map([
      ["A_0", 0],
      ["A_1", 1],
    ]),
    errors: [
      {
        type: "pcb_pad_trace_clearance_error",
        pcb_trace_id: "A_0",
        pcb_pad_id: "pad-b",
        __pad_ids: ["pad-b"],
        center: { x: 0, y: 0 },
        actual_clearance: 0.02,
        minimum_clearance: 0.1,
      },
    ],
    obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap: new ConnectivityMap({
      A: ["A", "port--1", "port-1"],
      B: ["B"],
    }),
    effort: 1,
  }
  expect(
    [...getPipeline9HighDensitySeamForceCandidates(params)].length,
  ).toBeGreaterThan(0)
  const variants: Array<{
    name: string
    overrides: Partial<Pipeline9HighDensitySeamForceCandidateParams>
  }> = [
    {
      name: "the peer fragment is not owned",
      overrides: { traceRouteIndexById: new Map([["A_0", 0]]) },
    },
    {
      name: "an unmatched route also ends at the seam",
      overrides: {
        hdRoutes: [
          ...routes,
          {
            ...routes[0]!,
            connectionName: "branch",
            route: [seam, { x: -1, y: 1, z: 0 }],
          },
        ],
      },
    },
    {
      name: "the handoff is a real PCB terminal",
      overrides: {
        hdRoutes: [
          { ...routes[0]!, endPcbPortId: "protected-terminal" },
          routes[1]!,
        ],
      },
    },
    {
      name: "a drilled via lies on the seam",
      overrides: {
        hdRoutes: [
          {
            ...routes[0]!,
            route: [
              { x: -2, y: 0, z: 0 },
              { x: -0.5, y: 0, z: 0 },
              { x: -0.5, y: 0, z: 1 },
              { x: 0, y: 0, z: 1 },
              { x: 0, y: 0, z: 0 },
            ],
            vias: [
              { x: -0.5, y: 0 },
              { x: 0, y: 0 },
            ],
          },
          routes[1]!,
        ],
      },
    },
    {
      name: "an existing same-net preloaded attachment uses the seam",
      overrides: {
        fixedHdRoutes: [
          {
            ...routes[0]!,
            connectionName: "preloaded",
            route: [
              { x: 0, y: -1, z: 0 },
              { x: 0, y: 1, z: 0 },
            ],
          },
        ],
      },
    },
    {
      name: "the topology contains more than one use of the handoff",
      overrides: {
        nodePortPoints: [
          nodes[0]!,
          {
            ...nodes[1]!,
            portPointsInPairs: [
              nodes[1]!.portPointsInPairs![0]!,
              nodes[1]!.portPointsInPairs![0]!,
            ],
          },
        ],
      },
    },
  ]
  for (const variant of variants) {
    expect(
      [
        ...getPipeline9HighDensitySeamForceCandidates({
          ...params,
          ...variant.overrides,
        }),
      ],
      variant.name,
    ).toEqual([])
  }
})
