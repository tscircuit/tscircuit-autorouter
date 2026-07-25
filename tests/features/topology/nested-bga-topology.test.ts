import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import {
  findNestedBgaTopologyComponents,
  getTopologyObstacleKey,
} from "lib/solvers/TopologyPlanningSolver/find-nested-bga-topology-components"
import { createComponentSrj } from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const createPad = (obstacleId: string, x: number, y: number): Obstacle => ({
  obstacleId,
  componentId: "U1",
  type: "rect",
  layers: ["top"],
  center: { x, y },
  width: 0.2,
  height: 0.2,
  connectedTo: [],
})

function visualizePads({
  obstacles,
  selectedObstacleIds,
  replacementObstacle,
}: {
  obstacles: Obstacle[]
  selectedObstacleIds: ReadonlySet<string>
  replacementObstacle?: Obstacle
}): GraphicsObject {
  return {
    rects: [
      ...obstacles.map((obstacle) => {
        const isSelected = selectedObstacleIds.has(
          getTopologyObstacleKey(obstacle),
        )
        return {
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: isSelected ? "#86efac" : "#cbd5e1",
          stroke: isSelected ? "#15803d" : "#64748b",
        }
      }),
      ...(replacementObstacle
        ? [
            {
              center: replacementObstacle.center,
              width: replacementObstacle.width,
              height: replacementObstacle.height,
              fill: "rgba(59, 130, 246, 0.05)",
              stroke: "#2563eb",
            },
          ]
        : []),
    ],
  }
}

test(
  "uses a complete pad grid inside a mixed component as BGA topology",
  async () => {
    const grid = Array.from({ length: 25 }, (_, index) =>
      createPad(`grid-${index}`, index % 5, Math.floor(index / 5)),
    )
    const perimeter = Array.from({ length: 7 }, (_, index) =>
      createPad(`edge-${index}`, index * 0.46 - 1, -2),
    )
    const inputSrj: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.1,
      obstacles: [...grid, ...perimeter],
      connections: [],
      bounds: { minX: -3, maxX: 7, minY: -3, maxY: 7 },
    }

    const [component] = findNestedBgaTopologyComponents({
      inputSrj,
      excludedComponentIds: new Set(),
    })

    expect(component?.componentKind).toBe("bga")
    expect(component?.memberObstacleIds).toHaveLength(25)
    const componentSrj = createComponentSrj({
      inputSrj,
      component: component!,
    })
    expect(
      componentSrj.obstacles.filter(
        (obstacle) => obstacle.componentId === component!.componentId,
      ),
    ).toHaveLength(25)

    const selectedObstacleIds = new Set(component!.memberObstacleIds)
    const svg = getGraphicsSvgFrames({
      frames: [
        {
          name: "1 · Before: mixed component",
          hideMetadata: true,
          graphics: visualizePads({
            obstacles: inputSrj.obstacles,
            selectedObstacleIds: new Set(),
          }),
        },
        {
          name: "2 · Detect: complete 5×5 grid",
          hideMetadata: true,
          graphics: visualizePads({
            obstacles: inputSrj.obstacles,
            selectedObstacleIds,
          }),
        },
        {
          name: "3 · After: component-local BGA",
          hideMetadata: true,
          graphics: visualizePads({
            obstacles: componentSrj.obstacles,
            selectedObstacleIds,
            replacementObstacle: component!.replacementObstacle,
          }),
        },
      ],
      columns: 3,
    })

    await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
  },
  { timeout: 15_000 },
)
