import { expect, test } from "bun:test"
import { findNestedBgaTopologyComponents } from "lib/solvers/TopologyPlanningSolver/find-nested-bga-topology-components"
import { createComponentSrj } from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"
import type { Obstacle, SimpleRouteJson } from "lib/types"

const createPad = (
  obstacleId: string,
  x: number,
  y: number,
): Obstacle => ({
  obstacleId,
  componentId: "U1",
  type: "rect",
  layers: ["top"],
  center: { x, y },
  width: 0.2,
  height: 0.2,
  connectedTo: [],
})

test("uses a complete pad grid inside a mixed component as BGA topology", () => {
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
})
