import type { SimpleRouteJson } from "lib/types"

export function getFixedCopperObstacleIndexes({
  inputSrj,
  representedPadObstacleIndexes,
}: {
  inputSrj: SimpleRouteJson
  representedPadObstacleIndexes: ReadonlySet<number>
}): Set<number> {
  const fixedCopperObstacleIndexes = new Set<number>()
  for (const [obstacleIndex, obstacle] of inputSrj.obstacles.entries()) {
    if (
      !representedPadObstacleIndexes.has(obstacleIndex) &&
      !obstacle.isCopperPour &&
      !obstacle.isNonPlatedHole &&
      !obstacle.isFanoutSourceKeepout
    ) {
      fixedCopperObstacleIndexes.add(obstacleIndex)
    }
  }
  return fixedCopperObstacleIndexes
}
