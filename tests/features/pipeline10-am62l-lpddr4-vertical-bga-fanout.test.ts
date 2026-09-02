import { expect, test } from "bun:test"
import { sample021 } from "@tscircuit/dataset-srj29-ddr3-bga-pairs"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver10_BgaFanout } from "lib/autorouter-pipelines/AutoroutingPipeline10_BgaFanout/AutoroutingPipelineSolver10_BgaFanout"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const MEMORY_COMPONENT_ID = "pcb_component_1"

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function moveComponent({
  inputSrj,
  componentId,
  targetCenter,
}: {
  inputSrj: SimpleRouteJson
  componentId: string
  targetCenter: { x: number; y: number }
}): void {
  const componentObstacles = inputSrj.obstacles.filter(
    (obstacle) => obstacle.componentId === componentId,
  )
  if (componentObstacles.length === 0) {
    throw new Error(`Expected obstacles for ${componentId}`)
  }
  const bounds: Bounds = {
    minX: Math.min(
      ...componentObstacles.map(
        (obstacle) => obstacle.center.x - obstacle.width / 2,
      ),
    ),
    maxX: Math.max(
      ...componentObstacles.map(
        (obstacle) => obstacle.center.x + obstacle.width / 2,
      ),
    ),
    minY: Math.min(
      ...componentObstacles.map(
        (obstacle) => obstacle.center.y - obstacle.height / 2,
      ),
    ),
    maxY: Math.max(
      ...componentObstacles.map(
        (obstacle) => obstacle.center.y + obstacle.height / 2,
      ),
    ),
  }
  const delta = {
    x: targetCenter.x - (bounds.minX + bounds.maxX) / 2,
    y: targetCenter.y - (bounds.minY + bounds.maxY) / 2,
  }

  for (const obstacle of componentObstacles) {
    obstacle.center.x += delta.x
    obstacle.center.y += delta.y
  }
  for (const connection of inputSrj.connections) {
    for (const point of connection.pointsToConnect) {
      if (
        point.x < bounds.minX ||
        point.x > bounds.maxX ||
        point.y < bounds.minY ||
        point.y > bounds.maxY
      ) {
        continue
      }
      point.x += delta.x
      point.y += delta.y
    }
  }
}

test("Pipeline 10 fans out vertical AM62L LPDDR4 signals", async () => {
  const inputSrj = structuredClone(sample021) as SimpleRouteJson
  const routedConnectionNames = new Set([
    "DQ2",
    "DQ3",
    "DQ10",
    "DQ11",
    "DQS0",
    "DQS1",
    "A4",
    "CKE0",
    "CK0",
  ])
  inputSrj.connections = inputSrj.connections.filter((connection) =>
    routedConnectionNames.has(connection.name),
  )
  inputSrj.buses = inputSrj.buses
    ?.map((bus) => ({
      ...bus,
      connectionNames: bus.connectionNames.filter((connectionName) =>
        routedConnectionNames.has(connectionName),
      ),
    }))
    .filter((bus) => bus.connectionNames.length > 0)
  inputSrj.differentialPairs = inputSrj.differentialPairs?.filter((pair) =>
    pair.connectionNames.every((connectionName) =>
      routedConnectionNames.has(connectionName),
    ),
  )
  moveComponent({
    inputSrj,
    componentId: MEMORY_COMPONENT_ID,
    targetCenter: { x: -10, y: 36 },
  })
  inputSrj.bounds = { minX: -50, maxX: 50, minY: -50, maxY: 50 }
  inputSrj.outline = [
    { x: -50, y: -50 },
    { x: 50, y: -50 },
    { x: 50, y: 50 },
    { x: -50, y: 50 },
  ]

  const pipeline = new AutoroutingPipelineSolver10_BgaFanout(inputSrj, {
    cacheProvider: null,
  })
  pipeline.solveUntilStage("autoroutingPipelineSolver")

  expect(pipeline.failed).toBe(false)
  expect(pipeline.getCurrentStageName()).toBe("autoroutingPipelineSolver")
  expect(pipeline.firstBgaFanoutSolver!.getOutput().validation.valid).toBe(true)
  expect(pipeline.secondBgaFanoutSolver!.getOutput().validation.valid).toBe(
    true,
  )

  const fannedOutSrj =
    pipeline.secondBgaFanoutSolver!.getOutputSimpleRouteJson()
  const graphics: GraphicsObject = convertSrjToGraphicsObject(fannedOutSrj, {
    traceColorMode: "net",
  })
  graphics.texts = [
    ...(graphics.texts ?? []),
    {
      x: -10,
      y: -8,
      text: "AM62L32 controller",
      fontSize: 0.8,
      color: "black",
      anchorSide: "center",
    },
    {
      x: -10,
      y: 44,
      text: "LPDDR4 memory • north-facing fanout",
      fontSize: 0.8,
      color: "black",
      anchorSide: "center",
    },
  ]

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "AM62L LPDDR4 • vertical Pipeline 10 BGA fanout",
          pipeline: "end",
          graphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
