import type { FixedObstacleViolation } from "@tscircuit/repair04"
import type { SimpleRouteJson } from "lib/types"

type FixedCopperConflictKey = string

export function getFixedCopperConflictKey(
  violation: FixedObstacleViolation,
  inputSrj: SimpleRouteJson,
): FixedCopperConflictKey {
  const obstacle = inputSrj.obstacles[violation.obstacleIndex]!
  const connectedTo = [...obstacle.connectedTo].sort()
  return JSON.stringify([violation.routeIndex, connectedTo])
}

export function getFixedCopperConflictSeverities(
  violations: FixedObstacleViolation[],
  inputSrj: SimpleRouteJson,
): Map<FixedCopperConflictKey, number> {
  const severities = new Map<FixedCopperConflictKey, number>()
  for (const violation of violations) {
    const key = getFixedCopperConflictKey(violation, inputSrj)
    severities.set(key, Math.max(severities.get(key) ?? 0, violation.severity))
  }
  return severities
}
