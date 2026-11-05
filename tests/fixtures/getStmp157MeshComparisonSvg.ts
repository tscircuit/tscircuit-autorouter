import {
  doesSegmentIntersectRect,
  getSegmentIntersection,
} from "@tscircuit/math-utils"
import {
  getBounds,
  getSvgFromGraphicsObject,
  type GraphicsObject,
  type Line,
  type Viewbox,
} from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { stackSvgsHorizontally, stackSvgsVertically } from "stack-svgs"

type ComparisonSide = {
  input: SimpleRouteJson
  mergedNodes: CapacityMeshNode[]
  capacityNodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
}

const crop = { minX: -12, maxX: -8, minY: -4, maxY: 0 }

function clipLine({
  line,
  view,
}: {
  line: Line
  view: Viewbox
}): Line | undefined {
  const [start, end] = line.points
  if (!start || !end) throw new Error("Comparison line has no endpoints")
  if (!doesSegmentIntersectRect(start, end, view)) return undefined
  const corners = [
    { x: view.minX, y: view.minY },
    { x: view.maxX, y: view.minY },
    { x: view.maxX, y: view.maxY },
    { x: view.minX, y: view.maxY },
  ]
  const points = [start, end].filter(
    (point) =>
      point.x >= view.minX &&
      point.x <= view.maxX &&
      point.y >= view.minY &&
      point.y <= view.maxY,
  )
  for (let index = 0; index < corners.length; index++) {
    const intersection = getSegmentIntersection(
      start,
      end,
      corners[index]!,
      corners[(index + 1) % corners.length]!,
    )
    if (intersection) points.push(intersection)
  }
  points.sort(
    (a, b) =>
      Math.hypot(a.x - start.x, a.y - start.y) -
      Math.hypot(b.x - start.x, b.y - start.y),
  )
  if (points.length < 2) return undefined
  return { ...line, points: [points[0]!, points.at(-1)!], label: undefined }
}

function renderPanel({
  graphics,
  view,
  titles,
}: {
  graphics: GraphicsObject
  view: Viewbox
  titles: string[]
}): string {
  const fontSize = (view.maxX - view.minX) * 0.028
  return getSvgFromGraphicsObject(
    {
      ...graphics,
      coordinateSystem: "cartesian",
      rects: [
        ...(graphics.rects ?? []),
        {
          center: {
            x: (view.minX + view.maxX) / 2,
            y: (view.minY + view.maxY) / 2,
          },
          width: view.maxX - view.minX,
          height: view.maxY - view.minY,
          fill: "none",
          stroke: "#64748b",
        },
      ],
      texts: titles.map((text, index) => ({
        x: view.minX,
        y: view.maxY + fontSize * (titles.length - index) * 1.6,
        text,
        fontSize,
        anchorSide: "center_left",
      })),
    },
    {
      backgroundColor: "white",
      svgWidth: 900,
      svgHeight: 720,
      includeTextLabels: false,
    },
  )
}

/** Completed preparation stages; only their drawings are cropped. */
export function getStmp157MeshComparisonSvg({
  before,
  after,
}: {
  before: ComparisonSide
  after: ComparisonSide
}): string {
  const inputGraphics = [before, after].map(({ input }) => {
    const graphics = convertSrjToGraphicsObject(input)
    return {
      ...graphics,
      points: [],
      rects: graphics.rects.map((rect) => ({
        ...rect,
        fill: "rgba(220,38,38,0.35)",
      })),
    }
  })
  const overview = getBounds(inputGraphics[0]!)
  const rows: string[][] = [[], [], []]
  for (const [index, side] of [before, after].entries()) {
    const { input, mergedNodes, capacityNodes, edges } = side
    let heading = "BEFORE: existing copper becomes rectangles"
    if (index === 1) heading = "AFTER: existing copper stays native traces"
    rows[0]!.push(
      renderPanel({
        graphics: {
          ...inputGraphics[index],
          lines: [
            ...inputGraphics[index]!.lines,
            {
              points: [
                { x: crop.minX, y: crop.minY },
                { x: crop.maxX, y: crop.minY },
                { x: crop.maxX, y: crop.maxY },
                { x: crop.minX, y: crop.maxY },
                { x: crop.minX, y: crop.minY },
              ],
              strokeColor: "#111827",
              strokeWidth: 0.15,
            },
          ],
        },
        view: overview,
        titles: [
          heading,
          `${input.obstacles.length.toLocaleString("en-US")} input obstacles; ${input.traces?.length ?? 0} native traces`,
          "Same 710 pads and 32 completed DQ traces; 40 signals not routed",
        ],
      }),
    )

    const visibleCells = mergedNodes.filter(
      (node) =>
        node.availableZ.includes(0) &&
        node.center.x + node.width / 2 > crop.minX &&
        node.center.x - node.width / 2 < crop.maxX &&
        node.center.y + node.height / 2 > crop.minY &&
        node.center.y - node.height / 2 < crop.maxY,
    )
    const rects = visibleCells.map((node) => {
      const minX = Math.max(crop.minX, node.center.x - node.width / 2)
      const maxX = Math.min(crop.maxX, node.center.x + node.width / 2)
      const minY = Math.max(crop.minY, node.center.y - node.height / 2)
      const maxY = Math.min(crop.maxY, node.center.y + node.height / 2)
      return {
        ...createRectFromCapacityNode(node),
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        width: maxX - minX,
        height: maxY - minY,
        stroke: "#55758c",
        label: undefined,
      }
    })
    const cellBoundaries: Line[] = rects.map(({ center, width, height }) => ({
      points: [
        { x: center.x - width / 2, y: center.y - height / 2 },
        { x: center.x + width / 2, y: center.y - height / 2 },
        { x: center.x + width / 2, y: center.y + height / 2 },
        { x: center.x - width / 2, y: center.y + height / 2 },
        { x: center.x - width / 2, y: center.y - height / 2 },
      ],
      strokeColor: "#55758c",
      strokeWidth: 0.0025,
    }))
    rows[1]!.push(
      renderPanel({
        graphics: {
          rects,
          lines: cellBoundaries,
        },
        view: crop,
        titles: [
          "Merged mesh · top layer · identical 4 × 4 mm crop",
          `${mergedNodes.length.toLocaleString("en-US")} cells across all board layers`,
          `${visibleCells.length.toLocaleString("en-US")} cells intersect this crop; mesh output only`,
        ],
      }),
    )

    const nodeById = new Map<CapacityMeshNodeId, CapacityMeshNode>()
    for (const node of capacityNodes)
      nodeById.set(node.capacityMeshNodeId, node)
    const lines: Line[] = []
    for (const edge of edges) {
      const start = nodeById.get(edge.nodeIds[0])
      const end = nodeById.get(edge.nodeIds[1])
      if (!start || !end) {
        throw new Error(
          `Missing comparison graph endpoint for ${edge.capacityMeshEdgeId}`,
        )
      }
      if (!start.availableZ.includes(0) || !end.availableZ.includes(0)) continue
      const clipped = clipLine({
        line: { points: [start.center, end.center], strokeColor: "#55758c" },
        view: crop,
      })
      if (clipped) lines.push(clipped)
    }
    const points = capacityNodes
      .filter(
        (node) =>
          node.availableZ.includes(0) &&
          node.center.x >= crop.minX &&
          node.center.x <= crop.maxX &&
          node.center.y >= crop.minY &&
          node.center.y <= crop.maxY,
      )
      .map((node) => ({ ...node.center, color: "#183b56" }))
    rows[2]!.push(
      renderPanel({
        graphics: { lines, points },
        view: crop,
        titles: [
          "Capacity graph before trace preloading · same top-layer crop",
          `${capacityNodes.length.toLocaleString("en-US")} nodes; ${edges.length.toLocaleString("en-US")} edges across all layers`,
          `${lines.length.toLocaleString("en-US")} edge segments intersect this crop; not routed paths`,
        ],
      }),
    )
  }
  const panels = rows.map((row) =>
    stackSvgsHorizontally(row, { gap: 20, normalizeSize: false }),
  )
  return stackSvgsVertically(panels, { gap: 20, normalizeSize: false })
}
