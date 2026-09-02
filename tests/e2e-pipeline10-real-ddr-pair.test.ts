import { expect, test } from "bun:test"
import { sample001 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { ConnectionPoint, SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "./fixtures/solver-svg-frames"

type Bounds = SimpleRouteJson["bounds"]

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

const COMPONENT_OFFSETS_MM: Record<string, { x: number; y: number }> = {
  ddr3_bga: { x: 2, y: -14 },
  controller_bga: { x: -2, y: 14 },
}

function getComponentBounds(
  inputSrj: SimpleRouteJson,
  componentId: string,
): Bounds {
  const obstacles = inputSrj.obstacles.filter(
    (obstacle) => obstacle.componentId === componentId,
  )
  if (obstacles.length === 0) {
    throw new Error(`No obstacles found for ${componentId}`)
  }

  return {
    minX: Math.min(
      ...obstacles.map((obstacle) => obstacle.center.x - obstacle.width / 2),
    ),
    maxX: Math.max(
      ...obstacles.map((obstacle) => obstacle.center.x + obstacle.width / 2),
    ),
    minY: Math.min(
      ...obstacles.map((obstacle) => obstacle.center.y - obstacle.height / 2),
    ),
    maxY: Math.max(
      ...obstacles.map((obstacle) => obstacle.center.y + obstacle.height / 2),
    ),
  }
}

function pointIsInsideBounds(point: ConnectionPoint, bounds: Bounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

function getComponentIdForPoint(
  point: ConnectionPoint,
  componentBounds: Map<string, Bounds>,
): string {
  const matchingComponentIds = [...componentBounds.entries()]
    .filter(([, bounds]) => pointIsInsideBounds(point, bounds))
    .map(([componentId]) => componentId)
  if (matchingComponentIds.length !== 1) {
    throw new Error(
      `DDR endpoint belongs to ${matchingComponentIds.length} components`,
    )
  }

  return matchingComponentIds[0]!
}

function getComponentOffset(componentId: string): { x: number; y: number } {
  const offset = COMPONENT_OFFSETS_MM[componentId]
  if (!offset) {
    throw new Error(`No placement offset configured for ${componentId}`)
  }

  return offset
}

function placeRealDdrPair(
  sourceSrj: SimpleRouteJson,
  metadata: Srj29Metadata,
): SimpleRouteJson {
  const componentIds = [
    metadata.ddr3.componentId,
    metadata.controller.componentId,
  ]
  const originalComponentBounds = new Map(
    componentIds.map((componentId) => [
      componentId,
      getComponentBounds(sourceSrj, componentId),
    ]),
  )
  const obstacles = sourceSrj.obstacles.map((obstacle) => {
    const offset = getComponentOffset(obstacle.componentId!)
    return {
      ...structuredClone(obstacle),
      center: {
        x: obstacle.center.x + offset.x,
        y: obstacle.center.y + offset.y,
      },
    }
  })
  const connections = sourceSrj.connections.map((connection) => ({
    ...structuredClone(connection),
    pointsToConnect: connection.pointsToConnect.map((point) => {
      const componentId = getComponentIdForPoint(point, originalComponentBounds)
      const offset = getComponentOffset(componentId)
      return { ...point, x: point.x + offset.x, y: point.y + offset.y }
    }),
  }))
  const bounds = {
    minX:
      Math.min(
        ...obstacles.map((obstacle) => obstacle.center.x - obstacle.width / 2),
      ) - 7,
    maxX:
      Math.max(
        ...obstacles.map((obstacle) => obstacle.center.x + obstacle.width / 2),
      ) + 7,
    minY:
      Math.min(
        ...obstacles.map((obstacle) => obstacle.center.y - obstacle.height / 2),
      ) - 7,
    maxY:
      Math.max(
        ...obstacles.map((obstacle) => obstacle.center.y + obstacle.height / 2),
      ) + 7,
  }

  return {
    ...structuredClone(sourceSrj),
    obstacles,
    connections,
    bounds,
    outline: [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
    ],
  }
}

function addRealDdrContext(
  graphics: GraphicsObject,
  srj: SimpleRouteJson,
  metadata: Srj29Metadata,
): GraphicsObject {
  const ratsnestLines = srj.connections.map((connection) => ({
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
        x: -8.9,
        y: -24,
        text: `U12 • ${metadata.ddr3.partNumber}`,
        fontSize: 0.6,
        color: "#111827",
        anchorSide: "center",
      },
      {
        x: 12.5,
        y: 24,
        text: `U5 • ${metadata.controller.partNumber}`,
        fontSize: 0.6,
        color: "#111827",
        anchorSide: "center",
      },
      {
        x: 1.8,
        y: 0,
        text: `${metadata.referenceDesign.board} • all ${metadata.referenceDesign.directConnectionCount} audited DDR3 nets`,
        fontSize: 0.5,
        color: "#374151",
        anchorSide: "center",
      },
    ],
  }
}

test("e2e Pipeline 10 hands a real DDR pair to global autorouting", async () => {
  const metadata = sample001.metadata as unknown as Srj29Metadata
  const inputSrj = placeRealDdrPair(sample001 as SimpleRouteJson, metadata)

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

  const ddr3Bounds = getComponentBounds(inputSrj, metadata.ddr3.componentId)
  const controllerBounds = getComponentBounds(
    inputSrj,
    metadata.controller.componentId,
  )
  const horizontalGap = controllerBounds.minX - ddr3Bounds.maxX
  const verticalGap = controllerBounds.minY - ddr3Bounds.maxY
  expect(verticalGap).toBeGreaterThan(horizontalGap)
  expect(horizontalGap).toBeGreaterThanOrEqual(11)

  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj)
  pipeline.solveUntilStage("autoroutingPipelineSolver")

  expect(pipeline.failed).toBe(false)
  expect(pipeline.getCurrentStageName()).toBe("autoroutingPipelineSolver")
  expect(pipeline.firstBgaFanoutSolver!.getOutput().validation.valid).toBe(true)
  expect(pipeline.secondBgaFanoutSolver!.getOutput().validation.valid).toBe(
    true,
  )

  const fannedOutSrj =
    pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson()
  expect(fannedOutSrj.connections).toHaveLength(inputSrj.connections.length)
  expect(fannedOutSrj.traces!.length).toBeGreaterThanOrEqual(
    inputSrj.connections.length * 2,
  )
  for (const connection of fannedOutSrj.connections) {
    expect(
      connection.pointsToConnect.every(
        (point) =>
          !pointIsInsideBounds(point, ddr3Bounds) &&
          !pointIsInsideBounds(point, controllerBounds),
      ),
    ).toBe(true)
  }

  pipeline.step()
  pipeline.step()
  expect(pipeline.autoroutingPipelineSolver).toBeDefined()

  const outputGraphics = addRealDdrContext(
    convertSrjToGraphicsObject(fannedOutSrj, { traceColorMode: "net" }),
    fannedOutSrj,
    metadata,
  )
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "E2E • real two-BGA DDR pair reaches global autorouting",
          pipeline: "end",
          graphics: outputGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
