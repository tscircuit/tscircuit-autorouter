import { createBoundedRegionalRepairFixture } from "./pipeline9-bounded-regional-repair-fixture"

/** Two pad contacts whose repair contexts cannot include both signal routes. */
export const createScatteredBoundedRegionalRepairFixture = (): ReturnType<
  typeof createBoundedRegionalRepairFixture
> => {
  const fixture = createBoundedRegionalRepairFixture(2)
  for (const point of fixture.routes[1]!.route) point.y += 40
  for (const point of fixture.originalSrj.connections[1]!.pointsToConnect) {
    point.y += 40
  }
  for (const obstacle of fixture.originalSrj.obstacles.slice(3)) {
    obstacle.center.y += 40
  }
  fixture.originalSrj.bounds.maxY = 49
  return fixture
}
