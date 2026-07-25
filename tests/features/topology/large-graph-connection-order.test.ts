import { expect, test } from "bun:test"
import tinyInput from "fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import type { GraphicsObject } from "graphics-debug"
import {
  LARGE_GRAPH_HEURISTIC_WEIGHT,
  orderLargeGraphConnections,
  TinyHypergraphPortPointPathingSolver,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

function createConnection(
  connectionId: string,
  mutuallyConnectedNetworkId: string,
  end: { x: number; y: number; layer: string },
) {
  return {
    connectionId,
    mutuallyConnectedNetworkId,
    startRegion: {},
    endRegion: {},
    simpleRouteConnection: {
      name: connectionId,
      pointsToConnect: [{ x: 0, y: 0, layer: "top" }, end],
    },
  }
}

type TestConnection = ReturnType<typeof createConnection>

function visualizeConnectionOrder(
  connections: TestConnection[],
  heuristicWeight: number,
): GraphicsObject {
  const netSizes = new Map<string, number>()
  for (const connection of connections) {
    netSizes.set(
      connection.mutuallyConnectedNetworkId,
      (netSizes.get(connection.mutuallyConnectedNetworkId) ?? 0) + 1,
    )
  }

  return {
    rects: connections.map((_, index) => ({
      center: { x: 2.5, y: connections.length - index - 1 },
      width: 5,
      height: 0.72,
      fill: index === 0 ? "#dcfce7" : "#f8fafc",
      stroke: index === 0 ? "#16a34a" : "#94a3b8",
    })),
    lines: connections.map((connection, index) => {
      const [start, end] = connection.simpleRouteConnection.pointsToConnect
      const changesLayer = start!.layer !== end!.layer
      const distance = Math.hypot(start!.x - end!.x, start!.y - end!.y)
      return {
        points: [
          { x: 3.45, y: connections.length - index - 1 },
          {
            x: 3.45 + Math.min(1.1, 0.3 + distance * 0.08),
            y: connections.length - index - 1,
          },
        ],
        strokeColor: changesLayer ? "#7c3aed" : "#0284c7",
        strokeWidth: 0.12,
      }
    }),
    circles: connections.flatMap((connection, index) => {
      const [start, end] = connection.simpleRouteConnection.pointsToConnect
      if (start!.layer === end!.layer) return []
      return [
        {
          center: { x: 4.75, y: connections.length - index - 1 },
          radius: 0.13,
          fill: "#f97316",
          stroke: "#9a3412",
        },
      ]
    }),
    texts: [
      ...connections.flatMap((connection, index) => {
        const rowY = connections.length - index - 1
        const [start, end] = connection.simpleRouteConnection.pointsToConnect
        return [
          {
            x: 0.2,
            y: rowY,
            text: `${index + 1}`,
            anchorSide: "center_left" as const,
            fontSize: 0.22,
          },
          {
            x: 0.72,
            y: rowY,
            text: `${connection.connectionId} · ${connection.mutuallyConnectedNetworkId} (${netSizes.get(connection.mutuallyConnectedNetworkId)})`,
            anchorSide: "center_left" as const,
            fontSize: 0.18,
          },
          {
            x: 4.2,
            y: rowY,
            text: start!.layer === end!.layer ? "same layer" : "via first",
            anchorSide: "center_right" as const,
            fontSize: 0.16,
            color: start!.layer === end!.layer ? "#0369a1" : "#6d28d9",
          },
        ]
      }),
      {
        x: 0.1,
        y: -0.65,
        text: `A* heuristic: h × ${heuristicWeight}`,
        anchorSide: "center_left",
        fontSize: 0.2,
        color: heuristicWeight === 1 ? "#64748b" : "#7c3aed",
      },
    ],
  }
}

function visualizeOutputPreparation({
  outputCount,
  nodeCount,
  indexed,
}: {
  outputCount: number
  nodeCount: number
  indexed: boolean
}): GraphicsObject {
  const outputCenters = indexed
    ? [{ x: 3.5, y: 1 }]
    : [
        { x: 3.5, y: 1.75 },
        { x: 3.5, y: 0.25 },
      ]

  return {
    rects: [
      {
        center: { x: 0.75, y: 1.75 },
        width: 1.3,
        height: 0.62,
        fill: "#f8fafc",
        stroke: "#64748b",
      },
      {
        center: { x: 0.75, y: 0.25 },
        width: 1.3,
        height: 0.62,
        fill: "#f8fafc",
        stroke: "#64748b",
      },
      ...outputCenters.map((center) => ({
        center,
        width: 1.65,
        height: 0.82,
        fill: indexed ? "#dcfce7" : "#fef3c7",
        stroke: indexed ? "#15803d" : "#d97706",
      })),
    ],
    arrows: [
      {
        start: { x: 1.45, y: 1.75 },
        end: indexed ? { x: 2.62, y: 1.15 } : { x: 2.62, y: 1.75 },
        color: indexed ? "#16a34a" : "#d97706",
      },
      {
        start: { x: 1.45, y: 0.25 },
        end: indexed ? { x: 2.62, y: 0.85 } : { x: 2.62, y: 0.25 },
        color: indexed ? "#16a34a" : "#d97706",
      },
    ],
    texts: [
      {
        x: 0.75,
        y: 1.75,
        text: "getOutput()",
        anchorSide: "center",
        fontSize: 0.18,
      },
      {
        x: 0.75,
        y: 0.25,
        text: "getOutput()",
        anchorSide: "center",
        fontSize: 0.18,
      },
      ...outputCenters.map((center, index) => ({
        x: center.x,
        y: center.y,
        text: indexed ? "shared output" : `output ${index + 1}`,
        anchorSide: "center" as const,
        fontSize: 0.19,
      })),
      {
        x: 2.5,
        y: -0.55,
        text: indexed
          ? `${outputCount} object · ${nodeCount} nodes · Map lookup`
          : `${outputCount} objects · repeated build + scan`,
        anchorSide: "bottom_center",
        fontSize: 0.2,
        color: indexed ? "#15803d" : "#92400e",
      },
    ],
  }
}

test("orders larger nets first and cross-layer routes first within each net", async () => {
  const smallNet = createConnection("small-net", "net-b", {
    x: 0.1,
    y: 0,
    layer: "top",
  })
  const sameLayer = createConnection("same-layer", "net-a", {
    x: 1,
    y: 0,
    layer: "top",
  })
  const crossLayer = createConnection("cross-layer", "net-a", {
    x: 10,
    y: 0,
    layer: "bottom",
  })

  const inputConnections = [sameLayer, smallNet, crossLayer]
  const ordered = orderLargeGraphConnections(inputConnections as any)

  expect(ordered.map((connection) => connection.connectionId)).toEqual([
    "cross-layer",
    "same-layer",
    "small-net",
  ])

  const pathingSolver = new TinyHypergraphPortPointPathingSolver(
    structuredClone(tinyInput) as any,
  )
  pathingSolver.solve()
  const firstOutput = pathingSolver.getOutput()
  const secondOutput = pathingSolver.getOutput()
  expect(secondOutput).toBe(firstOutput)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "1 · Before: input sequence",
        hideMetadata: true,
        graphics: visualizeConnectionOrder(inputConnections, 1),
      },
      {
        name: "2 · After: large-net / via priority",
        hideMetadata: true,
        graphics: visualizeConnectionOrder(
          ordered as TestConnection[],
          LARGE_GRAPH_HEURISTIC_WEIGHT,
        ),
      },
      {
        name: "3 · Before: repeated output preparation",
        hideMetadata: true,
        graphics: visualizeOutputPreparation({
          outputCount: 2,
          nodeCount: firstOutput.nodesWithPortPoints.length,
          indexed: false,
        }),
      },
      {
        name: "4 · After: cached output + node index",
        hideMetadata: true,
        graphics: visualizeOutputPreparation({
          outputCount: Number(firstOutput === secondOutput),
          nodeCount: firstOutput.nodesWithPortPoints.length,
          indexed: true,
        }),
      },
    ],
    columns: 2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
}, 15_000)
