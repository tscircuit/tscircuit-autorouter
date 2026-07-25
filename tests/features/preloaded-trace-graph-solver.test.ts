import { expect, test } from "bun:test"
import { PreloadedTraceGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preloaded-trace-graph-solver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("preloaded trace projection refines narrow single-layer regions", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "diagonal-top",
      center: { x: 0, y: 0 },
      width: 0.05,
      height: 0.05,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "coarse-diagonal-top",
      center: { x: 0, y: 0 },
      width: 0.2,
      height: 0.2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "multilayer-diagonal",
      center: { x: 0, y: 0 },
      width: 0.05,
      height: 0.05,
      layer: "z0,1",
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "candidate-radius-compensation-top",
      center: { x: 0, y: 0.08 },
      width: 0.02,
      height: 0.02,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "off-diagonal-top",
      center: { x: 0, y: 1 },
      width: 0.2,
      height: 0.2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "via-bottom",
      center: { x: 2, y: 2 },
      width: 0.2,
      height: 0.2,
      layer: "bottom",
      availableZ: [1],
    },
    {
      capacityMeshNodeId: "wire-bottom",
      center: { x: 0, y: 2 },
      width: 0.05,
      height: 0.05,
      layer: "bottom",
      availableZ: [1],
    },
    {
      capacityMeshNodeId: "unrelated-bottom",
      center: { x: 0, y: 0 },
      width: 0.2,
      height: 0.2,
      layer: "bottom",
      availableZ: [1],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0,
    minViaPadDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded-diagonal",
        connection_name: "net1",
        route: [
          {
            route_type: "wire",
            x: -2,
            y: -2,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 2,
            y: 2,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "via",
            x: 2,
            y: 2,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.6,
            via_hole_diameter: 0.3,
          },
          {
            route_type: "wire",
            x: 2,
            y: 2,
            width: 0.1,
            layer: "bottom",
          },
          {
            route_type: "wire",
            x: -2,
            y: 2,
            width: 0.1,
            layer: "bottom",
          },
        ],
      },
    ],
  }

  const solver = new PreloadedTraceGraphSolver(capacityMeshNodes, srj)
  solver.solve()
  const connectedNodeIds = solver
    .getOutput()
    .filter((node) => node._preloadedFixedNetIds?.includes("net1"))
    .map((node) => node.capacityMeshNodeId)

  expect(connectedNodeIds).toContain("diagonal-top")
  expect(
    connectedNodeIds.some((nodeId) => nodeId.startsWith("via-bottom")),
  ).toBe(true)
  expect(connectedNodeIds).toContain("wire-bottom")
  expect(
    connectedNodeIds.some((nodeId) =>
      nodeId.startsWith("coarse-diagonal-top__preloaded_"),
    ),
  ).toBe(true)
  expect(
    connectedNodeIds.some(
      (nodeId) =>
        nodeId.startsWith("off-diagonal-top") ||
        nodeId.startsWith("unrelated-bottom"),
    ),
  ).toBe(false)
  const multilayerTraceNodes = solver
    .getOutput()
    .filter((node) => node.capacityMeshNodeId.startsWith("multilayer-diagonal"))
  expect(multilayerTraceNodes).toHaveLength(2)
  expect(
    multilayerTraceNodes.find((node) => node.availableZ.includes(0))
      ?._preloadedFixedNetIds,
  ).toContain("net1")
  expect(
    multilayerTraceNodes.find((node) => node.availableZ.includes(1))
      ?._preloadedFixedNetIds ?? [],
  ).not.toContain("net1")
  expect(connectedNodeIds).toContain("candidate-radius-compensation-top")
  const reservedCoarseChildren = solver
    .getOutput()
    .filter(
      (node) =>
        node.capacityMeshNodeId.startsWith("coarse-diagonal-top__preloaded_") &&
        node._preloadedFixedNetIds?.includes("net1"),
    )
  expect(reservedCoarseChildren.length).toBeGreaterThan(0)
  expect(
    reservedCoarseChildren.every(
      (node) => node.width <= 0.1 && node.height <= 0.1,
    ),
  ).toBe(true)
  expect(solver.stats).toMatchObject({
    preloadedTraceShapeCount: 3,
    inputNodeCount: capacityMeshNodes.length,
    usedContainmentCompensation: true,
  })
  expect(solver.stats.outputNodeCount).toBeGreaterThan(capacityMeshNodes.length)

  const boundedSolver = new PreloadedTraceGraphSolver(capacityMeshNodes, srj, 1)
  boundedSolver.solve()
  expect(boundedSolver.stats).toMatchObject({
    usedContainmentCompensation: true,
    refinementBudgetExhausted: true,
  })
  expect(
    boundedSolver
      .getOutput()
      .find(
        (node) =>
          node.capacityMeshNodeId === "candidate-radius-compensation-top",
      )?._preloadedFixedNetIds ?? [],
  ).toContain("net1")
  expect(boundedSolver.stats.outputNodeCount).toBeLessThanOrEqual(
    boundedSolver.stats.effectiveMaxOutputNodeCount,
  )
})

test("preloaded trace projection conservatively reserves boundary cells", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-diagonal",
        connection_name: "fixed-net",
        route: [
          {
            route_type: "wire",
            x: -2,
            y: -2,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 2,
            y: 2,
            width: 0.1,
            layer: "top",
          },
        ],
      },
    ],
  }
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        capacityMeshNodeId: "coarse",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        layer: "top",
        availableZ: [0],
      },
    ],
    srj,
  )

  solver.solve()

  const nodesInsideRequiredClearance = solver
    .getOutput()
    .filter(
      (node) =>
        Math.abs(node.center.y - node.center.x) / Math.SQRT2 < 0.2 - 1e-9 &&
        Math.abs(node.center.x) < 1.8 &&
        Math.abs(node.center.y) < 1.8,
    )
  expect(nodesInsideRequiredClearance.length).toBeGreaterThan(0)
  expect(
    nodesInsideRequiredClearance.every((node) =>
      node._preloadedFixedNetIds?.includes("fixed-net"),
    ),
  ).toBe(true)
})

test("preloaded trace projection reserves square-cap segment endpoints", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0,
    bounds: { minX: -1, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-horizontal",
        connection_name: "fixed-net",
        route: [
          {
            route_type: "wire",
            x: 0,
            y: 0,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 1,
            y: 0,
            width: 0.1,
            layer: "top",
          },
        ],
      },
    ],
  }
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        capacityMeshNodeId: "inside-endcap-clearance",
        center: { x: 1.08, y: 0 },
        width: 0.01,
        height: 0.01,
        layer: "top",
        availableZ: [0],
      },
      {
        capacityMeshNodeId: "outside-endcap-clearance",
        center: { x: 1.12, y: 0 },
        width: 0.01,
        height: 0.01,
        layer: "top",
        availableZ: [0],
      },
    ],
    srj,
  )

  solver.solve()

  expect(
    solver
      .getOutput()
      .find((node) => node.capacityMeshNodeId === "inside-endcap-clearance")
      ?._preloadedFixedNetIds,
  ).toEqual(["fixed-net"])
  expect(
    solver
      .getOutput()
      .find((node) => node.capacityMeshNodeId === "outside-endcap-clearance")
      ?._preloadedFixedNetIds,
  ).toBeUndefined()
})

test("axial preloaded traces refine into long conservative strips", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-horizontal",
        connection_name: "fixed-net",
        route: [
          {
            route_type: "wire",
            x: -2,
            y: 0,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 2,
            y: 0,
            width: 0.1,
            layer: "top",
          },
        ],
      },
    ],
  }
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        capacityMeshNodeId: "coarse",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        layer: "top",
        availableZ: [0],
      },
    ],
    srj,
  )

  solver.solve()

  const reservedNodes = solver
    .getOutput()
    .filter((node) => node._preloadedFixedNetIds?.includes("fixed-net"))
  expect(reservedNodes.length).toBeGreaterThan(0)
  expect(
    reservedNodes.some((node) => node.width === 4 && node.height <= 0.25),
  ).toBe(true)
  expect(solver.stats.refinementBudgetExhausted).toBe(false)
  expect(solver.stats.outputNodeCount).toBeLessThan(20)
})

test("separate same-net layer shapes keep one canonical fixed reservation", () => {
  const createLayerTrace = (pcbTraceId: string, layer: "top" | "bottom") => ({
    type: "pcb_trace" as const,
    pcb_trace_id: pcbTraceId,
    connection_name: "shared-child",
    route: [
      {
        route_type: "wire" as const,
        x: -1,
        y: 0,
        width: 0.1,
        layer,
      },
      {
        route_type: "wire" as const,
        x: 1,
        y: 0,
        width: 0.1,
        layer,
      },
    ],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "shared-child",
        __rootConnectionNames: ["shared-root"],
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
    ],
    traces: [
      createLayerTrace("fixed-top", "top"),
      createLayerTrace("fixed-bottom", "bottom"),
    ],
  }
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        capacityMeshNodeId: "both-layers",
        center: { x: 0, y: 0 },
        width: 0.02,
        height: 0.02,
        layer: "z0,1",
        availableZ: [0, 1],
      },
    ],
    srj,
  )

  solver.solve()

  expect(solver.getOutput()).toEqual([
    expect.objectContaining({
      capacityMeshNodeId: "both-layers",
      availableZ: [0, 1],
      _preloadedFixedNetIds: ["shared-root"],
    }),
  ])
})

test("semantic target nodes ignore unrelated partial trace ownership", () => {
  const createTrace = (
    pcbTraceId: string,
    connectionName: string,
    route: Array<{ x: number; y: number }>,
  ) => ({
    type: "pcb_trace" as const,
    pcb_trace_id: pcbTraceId,
    connection_name: connectionName,
    route: route.map(({ x, y }) => ({
      route_type: "wire" as const,
      x,
      y,
      width: 0.1,
      layer: "top" as const,
    })),
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "active-net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 4, layer: "top" },
        ],
      },
      {
        name: "fixed-other",
        pointsToConnect: [
          { x: 0.5, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [
      createTrace("same-net-partial", "active-net", [
        { x: -1, y: 0.85 },
        { x: 1, y: 0.85 },
      ]),
      createTrace("other-net-partial", "fixed-other", [
        { x: -1, y: 0.85 },
        { x: 1, y: 0.85 },
      ]),
      createTrace("other-net-full", "fixed-other", [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
      ]),
    ],
  }
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        capacityMeshNodeId: "coarse-semantic-target",
        center: { x: 0, y: 0 },
        width: 1.5,
        height: 1.5,
        layer: "top",
        availableZ: [0],
        _containsTarget: true,
        _targetConnectionName: "active-net",
        _connectedTo: ["active-net", "fixed-other"],
      },
      {
        capacityMeshNodeId: "fully-covered-semantic-target",
        center: { x: 3, y: 0 },
        width: 0.02,
        height: 0.02,
        layer: "top",
        availableZ: [0],
        _containsTarget: true,
        _connectedTo: ["active-net"],
      },
    ],
    srj,
  )

  solver.solve()

  expect(
    solver
      .getOutput()
      .find((node) => node.capacityMeshNodeId === "coarse-semantic-target")
      ?._preloadedFixedNetIds,
  ).toEqual(["active-net"])
  expect(
    solver
      .getOutput()
      .find(
        (node) => node.capacityMeshNodeId === "fully-covered-semantic-target",
      )?._preloadedFixedNetIds,
  ).toEqual(["fixed-other"])
})

test("bounded refinement prioritizes large partial cells independent of input order", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0,
    bounds: { minX: -1, minY: -5, maxX: 15, maxY: 5 },
    obstacles: [],
    connections: [],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "small-cell-trace",
        connection_name: "small-net",
        route: [
          {
            route_type: "wire",
            x: -0.5,
            y: 0,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 0.5,
            y: 0,
            width: 0.1,
            layer: "top",
          },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "large-cell-trace",
        connection_name: "large-net",
        route: [
          {
            route_type: "wire",
            x: 6.1,
            y: -3,
            width: 0.1,
            layer: "top",
          },
          {
            route_type: "wire",
            x: 6.1,
            y: 3,
            width: 0.1,
            layer: "top",
          },
        ],
      },
    ],
  }
  const solver = new PreloadedTraceGraphSolver(
    [
      {
        capacityMeshNodeId: "small-first",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layer: "top",
        availableZ: [0],
      },
      {
        capacityMeshNodeId: "large-second",
        center: { x: 10, y: 0 },
        width: 8,
        height: 8,
        layer: "top",
        availableZ: [0],
      },
    ],
    srj,
    3,
  )

  solver.solve()

  const largestReservedArea = Math.max(
    ...solver
      .getOutput()
      .filter((node) => node._preloadedFixedNetIds?.length)
      .map((node) => node.width * node.height),
  )
  expect(solver.stats.refinementBudgetExhausted).toBe(true)
  expect(largestReservedArea).toBeLessThanOrEqual(32)
})
