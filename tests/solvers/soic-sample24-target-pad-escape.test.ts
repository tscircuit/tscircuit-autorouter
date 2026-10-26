import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { SoicTopologyGeneratorSolver } from "lib/solvers/SoicTopologyGeneratorSolver/SoicTopologyGeneratorSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"

test("SOIC target copper retains the ordinary escape at sample24 U12.2", (): void => {
  // Actual U12 pad sizes and pitch: the 0.41 mm pad edge is shorter than
  // the ordinary free-space port margin for the board's 0.1524 mm traces.
  const obstacles: Obstacle[] = [168.7059999, 174.10599926].flatMap(
    (x, column) =>
      Array.from(
        { length: 8 },
        (_, row): Obstacle => ({
          type: "rect",
          obstacleId: `U12.${column}.${row}`,
          componentId: "U12",
          center: { x, y: 49.78517602 + row * 0.635 },
          width: 1.59999934,
          height: 0.40999918,
          layers: ["top"],
          connectedTo: column === 1 && row === 1 ? ["U12.2"] : [],
        }),
      ),
  )
  const inputSrj: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.1524,
    minViaPadDiameter: 0.2032,
    defaultObstacleMargin: 0.15,
    bounds: { minX: 166, maxX: 177, minY: 47, maxY: 57 },
    obstacles,
    connections: [
      {
        name: "ground_mst53",
        __rootConnectionNames: ["ground"],
        pointsToConnect: [
          {
            x: 172.9994,
            y: 50.03299874,
            layer: "bottom",
            pcb_port_id: "C70.1",
          },
          {
            x: 174.10599926,
            y: 50.42017602,
            layer: "top",
            pcb_port_id: "U12.2",
          },
        ],
      },
    ],
  }
  const detectedComponent: DetectedComponent = {
    componentId: "U12",
    componentKind: "soic",
    bounds: {
      __type: "rect",
      minX: 167.90600023,
      maxX: 174.90599893,
      minY: 49.58017643,
      maxY: 54.43517561,
    },
  }
  const solver = new SoicTopologyGeneratorSolver({
    inputSrj,
    detectedComponent,
  })
  solver.solve()
  const nodes = solver.getOutput().routingRegions
  const target = nodes.find(
    (node) => node.capacityMeshNodeId === "soic:U12:pad:U12.1.1:z0",
  )!
  const center = nodes.find(
    (node) => node.capacityMeshNodeId === "soic:U12:center",
  )!
  expect(target._containsObstacle).toBe(true)
  expect(target._containsTarget).toBe(true)
  expect(target._targetConnectionName).toBe("ground")
  expect(nodes.filter((node) => node._containsTarget)).toEqual([target])
  const ports = new AvailableSegmentPointSolver({
    nodes: [target, center],
    edges: [
      {
        capacityMeshEdgeId: "U12.2-inner-escape",
        nodeIds: [target.capacityMeshNodeId, center.capacityMeshNodeId],
      },
    ],
    traceWidth: inputSrj.minTraceWidth,
    obstacleMargin: inputSrj.defaultObstacleMargin,
    shouldReturnCrampedPortPoints: true,
  })
  ports.solve()
  const escapePorts = ports.getOutput().flatMap((segment) => segment.portPoints)
  expect(escapePorts).toHaveLength(1)
  expect(escapePorts[0]!.availableZ).toEqual([0])
  expect(escapePorts[0]!.cramped).toBe(false)
})
