import { expect, test } from "bun:test"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import {
  getGraphicsSvgFrames,
  type GraphicsSvgFrame,
} from "../fixtures/solver-svg-frames"

test("opposite-layer pad boundaries only redistribute overlapping foreign-net ports", async (): Promise<void> => {
  const frames: GraphicsSvgFrame[] = []
  const minTraceWidth = 0.15
  const cases = [
    {
      name: "Singleton fixed",
      xs: [0.475],
      expectedXs: [0.475],
      sameRoot: false,
    },
    {
      name: "Spaced nets fixed",
      xs: [0.45, 0.6],
      expectedXs: [0.45, 0.6],
      sameRoot: false,
    },
    {
      name: "Same-root fixed",
      xs: [0.475, 0.5],
      expectedXs: [0.475, 0.5],
      sameRoot: true,
    },
    {
      name: "Overlap separates",
      xs: [0.475, 0.5],
      expectedXs: [-0.5, 0.5],
      sameRoot: false,
    },
  ]

  for (const { z, padLayer, layerCount } of [
    { z: 0, padLayer: "bottom", layerCount: 2 },
    { z: 1, padLayer: "top", layerCount: 2 },
    { z: 1, padLayer: "bottom", layerCount: 4 },
  ]) {
    for (const scenario of cases) {
      const portPoints = scenario.xs.map((x, index) => ({
        x,
        y: 0,
        z,
        portPointId: `port_${index}`,
        connectionName: `signal_${index}`,
        rootConnectionName: scenario.sameRoot ? "ground" : `signal_${index}`,
      }))
      const nodes: NodeWithPortPoints[] = [-1, 1].map((y, index) => ({
        capacityMeshNodeId: `node_${index}`,
        center: { x: 0, y },
        width: 2,
        height: 2,
        availableZ: Array.from({ length: layerCount }, (_, layer) => layer),
        portPoints: structuredClone(portPoints),
        portPointsInPairs: portPoints.map((point) => [
          { ...point },
          { ...point, portPointId: undefined, y },
        ]),
      }))
      const inputNodes: InputNodeWithPortPoints[] = nodes.map((node) => ({
        ...node,
        availableZ: [...node.availableZ!],
        portPoints: portPoints.map((point) => ({
          ...point,
          connectionNodeIds: ["node_0", "node_1"],
          distToCentermostPortOnZ: Math.abs(point.x),
        })),
      }))
      const input = {
        nodeWithPortPoints: nodes,
        inputNodesWithPortPoints: inputNodes,
        minTraceWidth,
        layerCount,
        obstacles: [
          {
            type: "rect" as const,
            center: { x: 0, y: -1 },
            width: 2,
            height: 2,
            layers: [padLayer],
            connectedTo: ["pad_net"],
          },
        ],
      }
      const originalInput = structuredClone(input)
      const solver = new UniformPortDistributionSolver(input)
      const before = solver.visualize()
      solver.solve()

      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      expect(input).toEqual(originalInput)
      const output = solver.getOutput()
      expect(output).toHaveLength(2)
      const { expectedXs } = scenario
      for (const [nodeIndex, node] of output.entries()) {
        expect(node.capacityMeshNodeId).toBe(`node_${nodeIndex}`)
        expect(node.portPoints).toEqual(
          portPoints.map((point, index) => ({
            ...point,
            x: expectedXs[index],
          })),
        )
        expect(node.portPointsInPairs).toEqual(
          originalInput.nodeWithPortPoints[nodeIndex]!.portPointsInPairs!.map(
            ([start, end], index) => [{ ...start, x: expectedXs[index] }, end],
          ),
        )
      }

      if (z === 0) {
        for (const [step, graphics] of [
          ["start", before],
          ["end", solver.visualize()],
        ] as const) {
          graphics.points = graphics.points?.filter((point) =>
            point.label?.startsWith("z:"),
          )
          graphics.texts = [
            {
              x: -0.8,
              y: 1.6,
              text: "Top-layer ports",
              fontSize: 0.16,
              anchorSide: "bottom_left",
            },
            {
              x: -0.8,
              y: -1.6,
              text: "Bottom-layer pad",
              fontSize: 0.16,
              anchorSide: "bottom_left",
            },
          ]
          for (const line of graphics.lines ?? []) {
            if (line.strokeColor === "#fff822c9") {
              line.strokeWidth = minTraceWidth
            }
          }
          frames.push({
            name: scenario.name,
            step,
            iteration: step === "start" ? 0 : solver.iterations,
            graphics,
          })
        }
      }
    }
  }

  await expect(
    getGraphicsSvgFrames({ frames, columns: 4, backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
