import { expect, test } from "bun:test"
import { createPortPointSection } from "lib/solvers/MultiSectionPortPointOptimizer/createPortPointSection"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

test("section paths retain only one point outside each crossed boundary", async () => {
  const nodeIds = [
    "far-left",
    "boundary-left",
    "inside",
    "boundary-right",
    "far-right",
  ]
  const capacityMeshNodes = nodeIds.map((capacityMeshNodeId, x) => ({
    capacityMeshNodeId,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layer: "top",
    availableZ: [0],
  }))
  const capacityMeshEdges = nodeIds.slice(1).map((nodeId, index) => ({
    capacityMeshEdgeId: `edge-${index}`,
    nodeIds: [nodeIds[index]!, nodeId] as [string, string],
  }))
  const inputNodes = capacityMeshNodes.map((node) => ({
    ...node,
    portPoints: [],
  }))
  const path = nodeIds.map((currentNodeId, x) => ({
    prevCandidate: null,
    portPoint: null,
    currentNodeId,
    point: { x, y: 0 },
    z: 0,
    f: x,
    g: x,
    h: 0,
    distanceTraveled: x,
  }))

  const section = createPortPointSection(
    {
      inputNodes,
      capacityMeshNodes,
      capacityMeshEdges,
      nodeMap: new Map(
        inputNodes.map((node) => [node.capacityMeshNodeId, node]),
      ),
      connectionResults: [
        {
          connection: {
            name: "crossing-route",
            pointsToConnect: [
              { x: 0, y: 0, layer: "top" },
              { x: 4, y: 0, layer: "top" },
            ],
          },
          nodeIds: ["far-left", "far-right"],
          path,
          straightLineDistance: 4,
        },
      ],
    },
    {
      centerOfSectionCapacityNodeId: "inside",
      expansionDegrees: 0,
    },
  )

  expect([...section.nodeIds]).toEqual(["inside"])
  expect(section.sectionPaths).toHaveLength(1)
  expect(section.sectionPaths[0]).toMatchObject({
    originalStartIndex: 1,
    originalEndIndex: 3,
    hasEntryFromOutside: true,
    hasExitToOutside: true,
  })
  expect(section.sectionPaths[0]!.points.map((point) => point.nodeId)).toEqual([
    "boundary-left",
    "inside",
    "boundary-right",
  ])

  const meshRects = capacityMeshNodes.map((node) => ({
    center: node.center,
    width: node.width,
    height: node.height,
    fill:
      node.capacityMeshNodeId === "inside"
        ? "rgba(219, 234, 254, 0.4)"
        : "rgba(241, 245, 249, 0.35)",
    stroke: node.capacityMeshNodeId === "inside" ? "#2563eb" : "#94a3b8",
  }))
  const sectionPoints = section.sectionPaths[0]!.points
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: route crosses a one-region section",
        step: 0,
        graphics: {
          rects: meshRects,
          lines: [
            {
              points: path.map((candidate) => candidate.point),
              strokeColor: "#ef4444",
              strokeWidth: 0.08,
            },
          ],
        },
      },
      {
        name: "Result: one fixed point outside each boundary",
        step: 1,
        graphics: {
          rects: meshRects,
          lines: [
            {
              points: sectionPoints,
              strokeColor: "#16a34a",
              strokeWidth: 0.08,
            },
          ],
          circles: sectionPoints.map((point, index) => ({
            center: point,
            radius: index === 1 ? 0.08 : 0.12,
            fill: index === 1 ? "#2563eb" : "#16a34a",
          })),
        },
      },
    ],
    columns: 2,
    cellWidth: 5.5,
    cellHeight: 2,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
