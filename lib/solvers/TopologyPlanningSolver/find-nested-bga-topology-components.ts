import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { SerializedTopologyComponentInput } from "./MultiGraphTopologyPlannerSolver"

const COORDINATE_EPSILON = 1e-3
const MIN_AXIS_COUNT = 5
const MAX_AXIS_RATIO = 1.5

const coordinateKey = (value: number): number =>
  Math.round(value / COORDINATE_EPSILON)

export const getTopologyObstacleKey = (obstacle: Obstacle): string =>
  obstacle.obstacleId ??
  [
    obstacle.componentId ?? "no-component",
    coordinateKey(obstacle.center.x),
    coordinateKey(obstacle.center.y),
    coordinateKey(obstacle.width),
    coordinateKey(obstacle.height),
    obstacle.layers.join(","),
  ].join(":")

function getArithmeticSequences(values: number[]): number[][] {
  const coordinateByKey = new Map(
    values.map((value) => [coordinateKey(value), value]),
  )
  const coordinates = [...coordinateByKey.values()].sort(
    (left, right) => left - right,
  )
  const sequences = new Map<string, number[]>()

  for (let startIndex = 0; startIndex < coordinates.length; startIndex++) {
    for (
      let secondIndex = startIndex + 1;
      secondIndex < coordinates.length;
      secondIndex++
    ) {
      const start = coordinates[startIndex]!
      const pitch = coordinates[secondIndex]! - start
      const sequence: number[] = []

      for (let step = 0; ; step++) {
        const coordinate = coordinateByKey.get(
          coordinateKey(start + pitch * step),
        )
        if (coordinate === undefined) break
        sequence.push(coordinate)
      }

      if (sequence.length >= MIN_AXIS_COUNT) {
        sequences.set(sequence.map(coordinateKey).join(","), sequence)
      }
    }
  }

  return [...sequences.values()]
}

function findLargestCompleteGrid(obstacles: Obstacle[]): Obstacle[] {
  const obstacleByCoordinate = new Map(
    obstacles.map((obstacle) => [
      `${coordinateKey(obstacle.center.x)}:${coordinateKey(obstacle.center.y)}`,
      obstacle,
    ]),
  )
  const xSequences = getArithmeticSequences(
    obstacles.map((obstacle) => obstacle.center.x),
  )
  const ySequences = getArithmeticSequences(
    obstacles.map((obstacle) => obstacle.center.y),
  )
  let largestGrid: Obstacle[] = []

  for (const xCoordinates of xSequences) {
    for (const yCoordinates of ySequences) {
      const axisRatio = Math.max(
        xCoordinates.length / yCoordinates.length,
        yCoordinates.length / xCoordinates.length,
      )
      if (axisRatio > MAX_AXIS_RATIO) continue

      const grid = xCoordinates.flatMap((x) =>
        yCoordinates.flatMap((y) => {
          const obstacle = obstacleByCoordinate.get(
            `${coordinateKey(x)}:${coordinateKey(y)}`,
          )
          return obstacle ? [obstacle] : []
        }),
      )

      if (
        grid.length === xCoordinates.length * yCoordinates.length &&
        grid.length > largestGrid.length
      ) {
        largestGrid = grid
      }
    }
  }

  return largestGrid
}

function findNestedBgaObstacles({
  inputSrj,
  excludedComponentIds,
}: {
  inputSrj: SimpleRouteJson
  excludedComponentIds: ReadonlySet<string>
}): Array<{ componentId: string; obstacles: Obstacle[] }> {
  const obstaclesByComponent = new Map<string, Obstacle[]>()

  for (const obstacle of inputSrj.obstacles) {
    if (
      !obstacle.componentId ||
      excludedComponentIds.has(obstacle.componentId)
    ) {
      continue
    }
    const componentObstacles =
      obstaclesByComponent.get(obstacle.componentId) ?? []
    componentObstacles.push(obstacle)
    obstaclesByComponent.set(obstacle.componentId, componentObstacles)
  }

  return [...obstaclesByComponent.entries()].flatMap(
    ([componentId, componentObstacles]) => {
      const obstaclesByPadGeometry = new Map<string, Obstacle[]>()
      for (const obstacle of componentObstacles) {
        const geometryKey = [
          coordinateKey(obstacle.width),
          coordinateKey(obstacle.height),
          obstacle.layers.join(","),
        ].join(":")
        const matchingObstacles =
          obstaclesByPadGeometry.get(geometryKey) ?? []
        matchingObstacles.push(obstacle)
        obstaclesByPadGeometry.set(geometryKey, matchingObstacles)
      }

      const nestedGrid = [...obstaclesByPadGeometry.values()].reduce(
        (largest, obstacles) => {
          const candidate = findLargestCompleteGrid(obstacles)
          return candidate.length > largest.length ? candidate : largest
        },
        [] as Obstacle[],
      )

      return nestedGrid.length > 0 &&
        nestedGrid.length < componentObstacles.length
        ? [{ componentId, obstacles: nestedGrid }]
        : []
    },
  )
}

export function findNestedBgaTopologyComponents({
  inputSrj,
  excludedComponentIds,
}: {
  inputSrj: SimpleRouteJson
  excludedComponentIds: ReadonlySet<string>
}): SerializedTopologyComponentInput[] {
  return findNestedBgaObstacles({ inputSrj, excludedComponentIds }).map(
    ({ componentId, obstacles }, index) => {
      const bounds = getBoundsForObstacles(obstacles)
      const nestedComponentId = `${componentId}__nested_bga_${index}`
      const zLayers = Array.from({ length: inputSrj.layerCount }, (_, z) => z)

      return {
        componentId: nestedComponentId,
        componentKind: "bga",
        memberObstacleIds: obstacles.map(getTopologyObstacleKey),
        memberObstacles: obstacles,
        replacementObstacle: {
          obstacleId: `${nestedComponentId}_bounds`,
          componentId: nestedComponentId,
          type: "rect",
          layers: zLayers.map((z) =>
            mapZToLayerName(z, inputSrj.layerCount),
          ),
          __zLayers: zLayers,
          center: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
          connectedTo: [
            ...new Set(obstacles.flatMap((obstacle) => obstacle.connectedTo)),
          ],
        },
      }
    },
  )
}
