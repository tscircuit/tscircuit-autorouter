import { expect, test } from 'bun:test'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import fixture from '../fixtures/sample24-hdr77584-completed-copper.json'
import { SingleTransitionWithPlanarRoutesSolver } from '../../lib/solvers/HighDensitySolver/SingleTransitionWithPlanarRoutesSolver'
import { CompletedCopperWorldIndex, areRoutesClearOfCompletedCopper } from '../../lib/solvers/HighDensitySolver/completedCopperWorldIndex'
import { createMandatoryPortPointIndex } from '../../lib/solvers/HighDensitySolver/mandatoryPortPointIndex'
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from '../../lib/types/high-density-types'
import type { Obstacle } from '../../lib/types/srj-types'

test('actual77584 chooses certified alternatives before committing against all297 prior WORLD routes', () => {
  const before = JSON.stringify(fixture)
  const connMap = new ConnectivityMap(fixture.connMap)
  const index = new CompletedCopperWorldIndex({ layerCount: 8, allowBlindAndBuriedVias: false,
    traceClearance: .1, viaHoleDiameter: .15, minViaHoleEdgeToViaHoleEdgeClearance: .1 })
  index.addRoutes(fixture.priorRoutes as HighDensityIntraNodeRoute[])
  expect(fixture.priorRoutes).toHaveLength(297)
  expect(areRoutesClearOfCompletedCopper({ routes: fixture.oldUnsafeFiniteRoutes as HighDensityIntraNodeRoute[],
    routedPeerWorldIndex: index, connMap })).toBe(false)
  const solver = new SingleTransitionWithPlanarRoutesSolver({ nodeWithPortPoints: fixture.node as NodeWithPortPoints,
    viaDiameter: .3, traceThickness: .1, boardContext: { ...fixture.options, obstacles: fixture.obstacles as Obstacle[],
      connMap, coordinateScale: 1, mandatoryPortPointIndex: createMandatoryPortPointIndex(fixture.actualCohort as NodeWithPortPoints[]),
      routedPeerWorldIndex: index } })
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(areRoutesClearOfCompletedCopper({ routes: solver.solvedRoutes, routedPeerWorldIndex: index, connMap })).toBe(true)
  for (const route of solver.solvedRoutes) {
    const pair = fixture.node.portPointsInPairs.find((p) => p[0]!.connectionName === route.connectionName)!
    expect(route.route[0]).toEqual({ x: pair[0]!.x, y: pair[0]!.y, z: pair[0]!.z })
    expect(route.route.at(-1)).toEqual({ x: pair[1]!.x, y: pair[1]!.y, z: pair[1]!.z })
    expect(route.viaDiameter).toBe(.3)
    expect(route.traceThickness).toBe(.1)
  }
  expect(JSON.stringify(fixture)).toBe(before)
})
