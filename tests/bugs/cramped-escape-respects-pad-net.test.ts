import "bun-match-svg"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleTargetNecessaryCrampedPortPointSolver } from "../../lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import type { SegmentPortPoint } from "../../lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode, CapacityMeshNodeId } from "../../lib/types"
import { createRectFromCapacityNode } from "../../lib/utils/createRectFromCapacityNode"

test("cramped escape paths cannot pass through a foreign-net pad", (): void => {
  for (const padIndex of [1, 2]) {
    for (const padConnection of ["vcc", "gnd", "gnd-alias"]) {
      const sameNet = padConnection !== "vcc"
      const connectivityMap = new ConnectivityMap({ gnd: ["gnd", "gnd-alias"] })
      const nodes: CapacityMeshNode[] = Array.from({ length: 5 }, (_, index) => ({
        capacityMeshNodeId: `node-${index}`,
        center: { x: index, y: 0 },
        width: 1,
        height: 1,
        layer: "top",
        availableZ: [0],
        _containsObstacle: index === 0 || index === padIndex,
        _connectedTo:
          index === 0
            ? ["gnd"]
            : index === padIndex
              ? [padConnection]
              : undefined,
      }))
      const nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
      const portMap = new Map<CapacityMeshNodeId, SegmentPortPoint[]>()
      for (let index = 0; index < nodes.length - 1; index++) {
        const port: SegmentPortPoint = {
          segmentPortPointId: `port-${index}`,
          edgeId: `edge-${index}`,
          x: index + 0.5,
          y: 0,
          availableZ: [0],
          nodeIds: [
            nodes[index]!.capacityMeshNodeId,
            nodes[index + 1]!.capacityMeshNodeId,
          ],
          connectionName: null,
          distToCentermostPortOnZ: 0,
          cramped: index === 3,
        }
        for (const nodeId of port.nodeIds) {
          const ports = portMap.get(nodeId) ?? []
          ports.push(port)
          portMap.set(nodeId, ports)
        }
      }
      const solver = new SingleTargetNecessaryCrampedPortPointSolver({
        target: nodes[0]!,
        connectivityMap,
        mapOfCapacityMeshNodeIdToRef: nodeMap,
        mapOfCapacityMeshNodeIdToSegmentPortPoints: portMap,
        depthLimit: 4,
        shouldIgnoreCrampedPortPoints: false,
      })
      solver.solve()
      if (padIndex === 1 && !sameNet) {
        const graphics = solver.visualize()
        graphics.rects = nodes.map((node) => ({
          ...createRectFromCapacityNode(node),
          label: node._connectedTo?.join(",") ?? "free space",
        }))
        graphics.lines = solver.getOutput().map((candidate) => {
          const points: { x: number; y: number }[] = []
          for (
            let current: typeof candidate | null = candidate;
            current;
            current = current.parent
          ) {
            points.unshift({ x: current.port.x, y: current.port.y })
          }
          points.unshift(nodes[0]!.center)
          return { points, strokeColor: "red" }
        })
        expect(
          getSvgFromGraphicsObject(graphics, {
            backgroundColor: "white",
            includeTextLabels: true,
          }),
        ).toMatchSvgSnapshot(import.meta.path)
      }
      expect(solver.solved).toBe(true)
      expect(solver.getOutput()).toHaveLength(sameNet ? 1 : 0)
    }
  }
})
