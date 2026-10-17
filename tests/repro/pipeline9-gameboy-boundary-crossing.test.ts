import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
  type Line,
} from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"
import capturedInput from "./fixtures/gameboy-preserved-pico.srj.json"

const snapshot = async (
  graphics: GraphicsObject,
  name: string,
): Promise<void> => {
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  await expect(svg).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    const { Resvg } = await import("@resvg/resvg-js")
    const png = new Resvg(svg, {
      fitTo: { mode: "width", value: 1536 },
    })
      .render()
      .asPng()
    writeFileSync(
      join(import.meta.dir, "__snapshots__", `gameboy-${name}.png`),
      new Uint8Array(png),
    )
  }
}

const boundaryDetail = (
  input: SimpleRouteJson,
  node: NodeWithPortPoints,
  crossing: NodeWithPortPoints["portPoints"][number],
  gap: number,
  color: string,
): GraphicsObject => {
  const nearby = convertSrjToGraphicsObject({
    ...input,
    connections: [],
    obstacles: input.obstacles.filter(
      (obstacle) =>
        Math.abs(obstacle.center.x - node.center.x) < 1 &&
        Math.abs(obstacle.center.y - node.center.y) < 2,
    ),
  })
  const segments = (nearby.lines ?? []).flatMap((line) =>
    line.points.slice(1).map((end, index) => ({
      ...line,
      points: [line.points[index]!, end],
    })),
  )
  const lines = segments
    .filter(
      (line) =>
        line.layer === "z0" &&
        line.points.every(
          (point) =>
            Math.abs(point.x - node.center.x) < 1.2 &&
            Math.abs(point.y - node.center.y) < 2.5,
        ),
    )
    .map((line) => ({ ...line, label: undefined }))
  return {
    lines,
    rects: [
      ...(nearby.rects ?? [])
        .filter((rect) => rect.layer === "z0")
        .map((rect) => ({ ...rect, label: undefined })),
      {
        center: { x: node.center.x, y: node.center.y - 0.4 },
        width: 3.4,
        height: 6,
        stroke: "transparent",
        fill: "transparent",
      },
      {
        ...createRectFromCapacityNode(
          {
            ...node,
            availableZ: [0],
            layer: "top",
          },
          {
            zOffset: 0,
          },
        ),
        width: node.width,
        height: node.height,
        label: "",
        stroke: "#64748b",
        fill: "rgba(0,200,200,0.05)",
      },
    ],
    points: [{ ...crossing, color }],
    texts: [
      {
        x: crossing.x + 0.1,
        y: crossing.y + 0.12,
        text: "VBUS",
        color,
        fontSize: 0.14,
      },
      {
        x: node.center.x - 0.9,
        y: node.center.y - 3.0,
        text: "Red: existing top-layer copper",
        fontSize: 0.12,
      },
      {
        x: node.center.x - 0.9,
        y: node.center.y - 3.2,
        text: `Copper gap: ${gap.toFixed(4)} mm; required: 0.1500 mm`,
        fontSize: 0.12,
      },
    ],
  }
}

test("real Game Boy data reproduces VBUS crossing placement on preserved GND", async (): Promise<void> => {
  // Full outer-board SRJ from abse/gameboy 1.0.16, captured with tscircuit
  // 0.0.2837 after routing Pico. No synthetic geometry is added to the input.
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const original = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solveUntilPhase("highDensityRouteSolver")
  expect(solver.failed).toBeFalse()
  const after = solver
    .uniformPortDistributionSolver!.getOutput()
    .find((node) => node.capacityMeshNodeId === "new-cmn_77-345")!
  const before = solver
    .portPointPathingSolver!.getOutput()
    .nodesWithPortPoints.find(
      (node) => node.capacityMeshNodeId === after.capacityMeshNodeId,
    )!
  const crossingBefore = before.portPoints.find(
    (point) => point.portPointId === "ce1738_pp1_z0::0",
  )!
  const crossingAfter = after.portPoints.find(
    (point) => point.portPointId === crossingBefore.portPointId,
  )!
  const groundSegments: Line[] = convertSrjToGraphicsObject({
    ...input,
    connections: [],
    obstacles: [],
    traces: input.traces!.filter(
      (trace) => trace.connection_name === "source_trace_104",
    ),
  })
    .lines!.flatMap((line) =>
      line.points.slice(1).map((end, index) => ({
        ...line,
        points: [line.points[index]!, end],
      })),
    )
    .filter((line) => line.layer === "z0")
  const copperGap = (point: typeof crossingAfter): number =>
    Math.min(
      ...groundSegments.map(
        (line) =>
          pointToSegmentDistance(point, line.points[0]!, line.points[1]!) -
          ((line.strokeWidth ?? input.minTraceWidth) + input.minTraceWidth) / 2,
      ),
    )
  expect(crossingAfter.connectionName).toBe("source_net_11")
  expect(copperGap(crossingAfter)).toBeLessThan(0.15)
  expect(input).toEqual(original)

  // Contrast the crossing marker with the physical top-layer copper.
  const color = "#7c3aed"
  const board: GraphicsObject = convertSrjToGraphicsObject({
    ...input,
    connections: [],
  })
  board.lines = board.lines?.map((line) => ({ ...line, label: undefined }))
  board.rects = board.rects?.map((rect) => ({ ...rect, label: undefined }))
  board.circles = board.circles?.map((circle) => ({
    ...circle,
    label: undefined,
  }))
  board.polygons = [
    {
      points: input.outline!,
      stroke: "#334155",
      fill: "transparent",
      strokeWidth: input.minTraceWidth,
    },
  ]
  board.circles!.push({
    center: after.center,
    radius: 3,
    stroke: color,
    fill: "transparent",
  })
  board.texts = [
    {
      x: input.bounds.minX,
      y: input.bounds.maxY + 5,
      text: "abse/gameboy 1.0.16: actual board pads and 136 Pico traces",
      fontSize: 2.2,
    },
    {
      x: after.center.x + 10,
      y: after.center.y + 6,
      text: "Circled: VBUS / GND detail",
      color,
      fontSize: 1.8,
    },
  ]
  await snapshot(board, "board")
  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Before uniform spacing",
        step: "end",
        iteration: solver.portPointPathingSolver!.iterations,
        layer: 0,
        graphics: boundaryDetail(
          input,
          after,
          crossingBefore,
          copperGap(crossingBefore),
          color,
        ),
      },
      {
        name: "After uniform spacing",
        step: "end",
        iteration: solver.uniformPortDistributionSolver!.iterations,
        layer: 0,
        graphics: boundaryDetail(
          input,
          after,
          crossingAfter,
          copperGap(crossingAfter),
          color,
        ),
      },
    ],
    columns: 2,
    backgroundColor: "white",
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path, { svgName: "detail" })
  if (process.env.BUN_UPDATE_SNAPSHOTS) {
    // Rasterize the native SVG snapshot for an inline GitHub PR preview.
    const { Resvg } = await import("@resvg/resvg-js")
    writeFileSync(
      join(import.meta.dir, "__snapshots__", "gameboy-detail.png"),
      new Uint8Array(
        new Resvg(svg, { fitTo: { mode: "width", value: 1536 } })
          .render()
          .asPng(),
      ),
    )
  }
  solver.solve()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("No path found for source_net_11")
})
