import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9UniformPortValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9UniformPortValidator"
import { createPreloadedPortValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPreloadedPortValidator"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { SimpleRouteJson } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("uniform port distribution preserves clearance from foreign board obstacles on fixed-copper nodes", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.125,
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4 },
    obstacles: [
      {
        obstacleId: "foreign_top_pad",
        type: "rect",
        layers: ["top"],
        center: { x: 1.84, y: 0.84 },
        width: 0.32,
        height: 0.32,
        connectedTo: ["foreign_net"],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed_bga_trace",
        connection_name: "fixed_net",
        isFixed: true,
        route: [
          { route_type: "wire", x: 1.2, y: 2.0, width: 0.15, layer: "inner1" },
          { route_type: "wire", x: 1.8, y: 2.0, width: 0.15, layer: "inner1" },
        ],
      },
    ],
    connections: [],
  }
  const connMap = new ConnectivityMap({
    foreign_net: ["foreign_net"],
    fixed_net: ["fixed_net"],
    net_a: ["net_a"],
    net_b: ["net_b"],
    net_c: ["net_c"],
  })

  // Shared vertical edge x=2, y in [1.0, 2.14] (length=1.14).
  // Foreign pad occupies x in [1.68, 2.0], y in [0.68, 1.0] on z=0.
  // Uniform spacing for 3 ports places the lowest port at y=1.19 (0.19mm < 0.20mm),
  // whereas the original port at y=1.225 (0.225mm > 0.20mm) is clear.
  const ports: PortPoint[] = [
    { portPointId: "p0_z0", connectionName: "net_a", x: 2, y: 1.225, z: 0 },
    { portPointId: "p1_z0", connectionName: "net_b", x: 2, y: 1.57, z: 0 },
    { portPointId: "p2_z0", connectionName: "net_c", x: 2, y: 1.915, z: 0 },
    { portPointId: "p0_z2", connectionName: "net_a", x: 2, y: 1.225, z: 2 },
    { portPointId: "p1_z2", connectionName: "net_b", x: 2, y: 1.57, z: 2 },
    { portPointId: "p2_z2", connectionName: "net_c", x: 2, y: 1.915, z: 2 },
  ]
  const nodes: NodeWithPortPoints[] = [1.5, 2.5].map((x, index) => ({
    capacityMeshNodeId: index === 0 ? "left" : "right",
    center: { x, y: 1.57 },
    width: 1,
    height: 1.14,
    availableZ: [0, 2],
    portPoints: ports.map((port) => ({ ...port })),
  }))
  const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
    ...node,
    availableZ: [0, 2],
    portPoints: ports.map((port) => ({
      ...port,
      portPointId: port.portPointId!,
      connectionNodeIds: ["left", "right"],
      distToCentermostPortOnZ: 0,
    })),
  }))

  // Base preloaded copper validator only checks preloaded wires/vias.
  const isPreloadedCopperClear = createPreloadedPortValidator({
    srj,
    connMap,
    traceWidth: srj.minTraceWidth,
    viaDiameter: 0.3,
  })
  expect(
    isPreloadedCopperClear({
      portPointId: "p0_z0",
      x: 2,
      y: 1.19,
      z: 0,
      connectionName: "net_a",
    }),
  ).toBe(true)

  const isPortPointClear = createPipeline9UniformPortValidator({
    srj,
    connMap,
    traceWidth: srj.minTraceWidth,
    viaDiameter: 0.3,
    nodesWithPortPoints: nodes,
  })
  expect(
    isPortPointClear({
      portPointId: "p0_z0",
      x: 2,
      y: 1.19,
      z: 0,
      connectionName: "net_a",
    }),
  ).toBe(false)
  expect(
    isPortPointClear({
      portPointId: "p0_z0",
      x: 2,
      y: 1.19,
      z: 0,
      connectionName: "foreign_net",
    }),
  ).toBe(true)
  expect(
    isPortPointClear({
      portPointId: "p0_z0",
      x: 2,
      y: 1.225,
      z: 0,
      connectionName: "net_a",
    }),
  ).toBe(true)

  const solver = new UniformPortDistributionSolver({
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    useLayerAwareGeometry: true,
    isPortPointClear,
  })
  solver.solve()
  expect(solver.solved).toBe(true)

  const leftOut = solver
    .getOutput()
    .find((node) => node.capacityMeshNodeId === "left")!
  // z=0 preserves original clearance-safe positions because y=1.19 violates pad clearance.
  expect(leftOut.portPoints.filter((p) => p.z === 0).map((p) => p.y)).toEqual([
    1.225, 1.57, 1.915,
  ])
  // z=2 has no pad obstacle and redistributes uniformly to 1.0 + 1.14 * {1/6, 3/6, 5/6}.
  const z2Ys = leftOut.portPoints.filter((p) => p.z === 2).map((p) => p.y)
  expect(z2Ys[0]).toBeCloseTo(1.19, 6)
  expect(z2Ys[1]).toBeCloseTo(1.57, 6)
  expect(z2Ys[2]).toBeCloseTo(1.95, 6)
})
