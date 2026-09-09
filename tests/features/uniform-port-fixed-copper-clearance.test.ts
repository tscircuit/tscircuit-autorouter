import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("uniform port redistribution preserves foreign fixed-copper clearance and same-net access", () => {
  for (const nameKind of ["connection", "alias-root", "canonical-root"]) {
    for (const sameNet of [false, true]) {
      const connectivityMap = new ConnectivityMap({})
      connectivityMap.addConnections([
        ["fixed", "fixed-alias"],
        ["foreign-a"],
        ["foreign-b"],
      ])
      const ports: PortPoint[] = [-0.1, 0.1].map((y, index) => ({
        portPointId: `port-${index}`,
        x: 0,
        y,
        z: 0,
        connectionName:
          index === 1 && sameNet
            ? "fixed-alias"
            : `foreign-${index === 0 ? "a" : "b"}`,
      }))
      if (nameKind !== "connection") {
        for (const point of ports) {
          point.rootConnectionName =
            nameKind === "canonical-root"
              ? connectivityMap.getNetConnectedToId(point.connectionName)!
              : point.connectionName
        }
      }
      const nodes: NodeWithPortPoints[] = [-1, 1].map((x) => ({
        capacityMeshNodeId: `node-${x}`,
        center: { x, y: 0 },
        width: 2,
        height: 2,
        portPoints: structuredClone(ports),
        availableZ: [0],
      }))
      const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
        ...node,
        availableZ: [0],
        portPoints: node.portPoints.map((point) => ({
          ...point,
          portPointId: point.portPointId!,
          connectionNodeIds: ["node--1", "node-1"],
          distToCentermostPortOnZ: 0,
        })),
      }))
      const solver = new UniformPortDistributionSolver({
        nodeWithPortPoints: nodes,
        inputNodesWithPortPoints: inputNodes,
        obstacles: [],
        fixedCopper: {
          traceWidth: 0.15,
          clearance: 0.1,
          connectivityMap,
          routes: [
            {
              connectionName: "fixed-alias",
              rootConnectionName: connectivityMap.getNetConnectedToId("fixed")!,
              traceThickness: 0.1,
              viaDiameter: 0.3,
              vias: [],
              route: [
                { x: -1, y: 0.5, z: 0 },
                { x: 1, y: 0.5, z: 0 },
              ],
            },
          ],
        },
      })
      solver.solve()
      expect(solver.solved).toBe(true)
      const positions = solver.getOutput()[0]!.portPoints.map((p) => p.y)
      expect(positions).toEqual(sameNet ? [-0.5, 0.5] : [-0.1, 0.1])
    }
  }
})
