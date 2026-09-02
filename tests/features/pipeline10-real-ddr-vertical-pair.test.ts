import { expect, test } from "bun:test"
import { sample001 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"

type Srj29Metadata = {
  referenceDesign: {
    board: string
    directConnectionCount: number
  }
  ddr3: {
    componentId: string
    padCount: number
    partNumber: string
  }
  controller: {
    componentId: string
    padCount: number
    partNumber: string
  }
}

type Srj29Sample = SimpleRouteJson & { metadata: Srj29Metadata }

function rotateSampleCounterclockwise(sample: Srj29Sample): Srj29Sample {
  return {
    ...structuredClone(sample),
    obstacles: sample.obstacles.map((obstacle) => ({
      ...structuredClone(obstacle),
      center: { x: -obstacle.center.y, y: obstacle.center.x },
      width: obstacle.height,
      height: obstacle.width,
      ccwRotationDegrees: (obstacle.ccwRotationDegrees ?? 0) + 90,
    })),
    connections: sample.connections.map((connection) => ({
      ...structuredClone(connection),
      pointsToConnect: connection.pointsToConnect.map((point) => ({
        ...point,
        x: -point.y,
        y: point.x,
      })),
    })),
    bounds: {
      minX: -sample.bounds.maxY,
      maxX: -sample.bounds.minY,
      minY: sample.bounds.minX,
      maxY: sample.bounds.maxX,
    },
    outline: sample.outline?.map((point) => ({ x: -point.y, y: point.x })),
  }
}

function addRealDdrContext(
  graphics: GraphicsObject,
  inputSrj: Srj29Sample,
): GraphicsObject {
  const { metadata } = inputSrj
  const ratsnestLines = inputSrj.connections.map((connection) => ({
    points: connection.pointsToConnect.map(({ x, y }) => ({ x, y })),
    strokeColor: "rgba(55, 65, 81, 0.52)",
    strokeWidth: 0.08,
    strokeDash: [0.18, 0.12],
    label: connection.name,
  }))

  return {
    ...graphics,
    lines: [...(graphics.lines ?? []), ...ratsnestLines],
    texts: [
      ...(graphics.texts ?? []),
      {
        x: 0,
        y: inputSrj.bounds.minY + 4,
        text: `U12 • ${metadata.ddr3.partNumber}`,
        fontSize: 0.65,
        color: "#111827",
        anchorSide: "center",
      },
      {
        x: 0,
        y: inputSrj.bounds.maxY - 4,
        text: `U5 • ${metadata.controller.partNumber}`,
        fontSize: 0.65,
        color: "#111827",
        anchorSide: "center",
      },
      {
        x: 0,
        y: 0,
        text: `${metadata.referenceDesign.board} • all ${metadata.referenceDesign.directConnectionCount} audited DDR3 nets`,
        fontSize: 0.55,
        color: "#374151",
        anchorSide: "center",
      },
    ],
  }
}

test("Pipeline 10 reproduces vertical placement failure on a real DDR3 BGA pair", async () => {
  const inputSrj = rotateSampleCounterclockwise(sample001 as Srj29Sample)
  const { metadata } = inputSrj

  expect(inputSrj.connections).toHaveLength(
    metadata.referenceDesign.directConnectionCount,
  )
  expect(
    inputSrj.obstacles.filter(
      (obstacle) => obstacle.componentId === metadata.ddr3.componentId,
    ),
  ).toHaveLength(metadata.ddr3.padCount)
  expect(
    inputSrj.obstacles.filter(
      (obstacle) => obstacle.componentId === metadata.controller.componentId,
    ),
  ).toHaveLength(metadata.controller.padCount)

  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj)
  expect(() => pipeline.solveUntilStage("autoroutingPipelineSolver")).toThrow(
    "Pipeline 10 cannot provide 2mm fanout margins while retaining a 2mm routing corridor",
  )

  const detectedBgaIds = pipeline
    .componentDetectionSolver!.getOutput()
    .filter((component) => component.componentKind === "bga")
    .map((component) => component.componentId)
    .sort()
  expect(detectedBgaIds).toEqual(
    [metadata.controller.componentId, metadata.ddr3.componentId].sort(),
  )

  const inputGraphics = addRealDdrContext(
    convertSrjToGraphicsObject(inputSrj, { traceColorMode: "net" }),
    inputSrj,
  )
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "REPRO • Pipeline 10 rejects this vertical DDR3 pair",
          pipeline: "end",
          graphics: inputGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
