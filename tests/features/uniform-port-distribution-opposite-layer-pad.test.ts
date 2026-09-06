import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  getGraphicsSvgFrames,
  type GraphicsSvgFrame,
} from "../fixtures/solver-svg-frames"

test("overlapping top-layer ports are spaced despite a bottom pad boundary", async (): Promise<void> => {
  const frames: GraphicsSvgFrame[] = []
  const outputByLayer = new Map<number, NodeWithPortPoints[]>()
  for (const z of [0, 1]) {
    const portPoints = [0.475, 0.5].map((x, index) => ({
      x,
      y: 0,
      z,
      portPointId: `port_${index}_z${z}`,
      connectionName: `signal_${index}`,
    }))
    const nodes: NodeWithPortPoints[] = [-1, 1].map((y, index) => ({
      capacityMeshNodeId: `node_${index}`,
      center: { x: 0, y },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints,
    }))
    const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
      ...node,
      availableZ: [0, 1],
      portPoints: portPoints.map((point) => ({
        ...point,
        connectionNodeIds: ["node_0", "node_1"],
        distToCentermostPortOnZ: Math.abs(point.x),
      })),
    }))
    const solver = new UniformPortDistributionSolver({
      nodeWithPortPoints: nodes,
      inputNodesWithPortPoints: inputNodes,
      layerCount: 2,
      minTraceWidth: 0.15,
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: -1 },
          width: 2,
          height: 2,
          layers: ["bottom"],
          connectedTo: ["ground"],
        },
      ],
    })
    const layerName = z === 0 ? "Top" : "Bottom"
    const beforeGraphics = solver.visualize()
    beforeGraphics.points = beforeGraphics.points?.filter((point) =>
      point.label?.startsWith("z:"),
    )
    frames.push({
      name: `${layerName} ports: 0.025 mm apart`,
      step: "start",
      iteration: 0,
      graphics: beforeGraphics,
    })
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const afterGraphics = solver.visualize()
    afterGraphics.points = afterGraphics.points?.filter((point) =>
      point.label?.startsWith("z:"),
    )
    frames.push({
      name: z === 0 ? "Top ports: 1 mm apart" : "Bottom ports unchanged",
      step: "end",
      iteration: solver.iterations,
      graphics: afterGraphics,
    })
    outputByLayer.set(z, solver.getOutput())
    expect(nodes[0]!.portPoints.map((point) => point.x)).toEqual([0.475, 0.5])
  }

  await expect(
    getGraphicsSvgFrames({
      frames,
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  for (const node of outputByLayer.get(0)!) {
    expect(node.portPoints.map((point) => point.x)).toEqual([-0.5, 0.5])
    expect(node.portPoints[1]!.x - node.portPoints[0]!.x).toBe(1)
    expect(node.portPoints.map((point) => point.y)).toEqual([0, 0])
  }
  for (const node of outputByLayer.get(1)!) {
    expect(node.portPoints.map((point) => point.x)).toEqual([0.475, 0.5])
    expect(node.portPoints.map((point) => point.y)).toEqual([0, 0])
  }
})
