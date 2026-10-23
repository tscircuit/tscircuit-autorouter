import { getFixedObstacleViolations } from "@tscircuit/repair04"

type NativeFixedObstacleInput = Parameters<typeof getFixedObstacleViolations>[0]

/** Keep an explicit pairwise ownership relation out of the kernel's alias union. */
export function getFixedObstacleViolationsWithOwnership(input: NativeFixedObstacleInput & {
  isObstacleOwnedByRouteIndex: (routeIndex: number, obstacleIndex: number) => boolean
}): ReturnType<typeof getFixedObstacleViolations> {
  return input.routes.flatMap((route, routeIndex) => {
    // Each query contains one route. A pad shared by several routes cannot
    // transitively exempt a different pad for a route that does not own it.
    const name = "physical_query_route"
    const srj = { ...input.srj, connections: [], obstacles: input.srj.obstacles.map((obstacle, obstacleIndex) => ({
      ...obstacle, connectedTo: input.isObstacleOwnedByRouteIndex(routeIndex, obstacleIndex) ? [name] : [],
    })) }
    return getFixedObstacleViolations({ ...input, srj, routes: [{ ...route, connectionName: name, rootConnectionName: name }] }).map((violation) => ({
      ...violation, routeIndex, key: `fixed-obstacle:${routeIndex}:${violation.obstacleIndex}:${violation.kind}`,
    }))
  })
}
