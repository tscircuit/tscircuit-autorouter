export type RouteOrderConnection = {
  routeId: number
  netId: number
  start: { x: number; y: number }
  end: { x: number; y: number }
}

type RankedRoute = {
  routeId: number
  length: number
}

/** Keep each net contiguous, visiting short nets and their short branches first. */
export function getShortFirstRouteOrder(
  connections: readonly RouteOrderConnection[],
): number[] {
  const groups = new Map<number, RankedRoute[]>()
  for (const connection of connections) {
    const route = {
      routeId: connection.routeId,
      length: Math.hypot(
        connection.end.x - connection.start.x,
        connection.end.y - connection.start.y,
      ),
    }
    const group = groups.get(connection.netId)
    if (group) group.push(route)
    else groups.set(connection.netId, [route])
  }
  const orderedGroups = [...groups.values()].map((routes) => ({
    routes,
    meanLength:
      routes.reduce((sum, route) => sum + route.length, 0) / routes.length,
    firstRouteId: Math.min(...routes.map((route) => route.routeId)),
  }))
  orderedGroups.sort(
    (a, b) => a.meanLength - b.meanLength || a.firstRouteId - b.firstRouteId,
  )
  return orderedGroups.flatMap(({ routes }) =>
    routes
      .sort((a, b) => a.length - b.length || a.routeId - b.routeId)
      .map((route) => route.routeId),
  )
}
