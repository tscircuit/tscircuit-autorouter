import { expect, test } from 'bun:test'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import fixture from '../fixtures/sample24-hdr77369-grown-native-policies.json'
import { Pipeline9HighDensitySolver } from '../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver'
import { createMandatoryPortPointIndex } from '../../lib/solvers/HighDensitySolver/mandatoryPortPointIndex'
import { areRoutesClearOfCompletedCopper } from '../../lib/solvers/HighDensitySolver/completedCopperWorldIndex'
import type { NodeWithPortPoints, HighDensityIntraNodeRoute } from '../../lib/types/high-density-types'
import type { Obstacle } from '../../lib/types/srj-types'

test('actual77369 preserves native policy coverage after expanding WORLD bounds and retaining390 prior routes', () => {
  const before = JSON.stringify(fixture)
  const connMap = new ConnectivityMap(fixture.connMap)
  const solver = new Pipeline9HighDensitySolver({ ...fixture.options,
    nodePortPoints: [fixture.node] as NodeWithPortPoints[], obstacles: fixture.obstacles as Obstacle[],
    connMap, colorMap: {}, fixedHdRoutes: [],
    mandatoryPortPointIndex: createMandatoryPortPointIndex(fixture.actualCohort as NodeWithPortPoints[]) })
  solver.completedCopperWorldIndex.addRoutes(fixture.priorRoutes as HighDensityIntraNodeRoute[])
  expect(fixture.priorRoutes).toHaveLength(390)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(2)
  expect(areRoutesClearOfCompletedCopper({ routes: solver.routes,
    routedPeerWorldIndex: solver.completedCopperWorldIndex, connMap })).toBe(true)
  for (const route of solver.routes) {
    const pair = fixture.node.portPointsInPairs.find((p) => p[0]!.connectionName === route.connectionName)!
    expect(route.route[0]).toEqual({ x: pair[0]!.x, y: pair[0]!.y, z: pair[0]!.z })
    expect(route.route.at(-1)).toEqual({ x: pair[1]!.x, y: pair[1]!.y, z: pair[1]!.z })
    expect(route.traceThickness).toBe(.1)
    expect(route.viaDiameter).toBe(.3)
    for (const point of route.route) {
      expect(point.x).toBeGreaterThan(fixture.selectionBounds.minX + .3)
      expect(point.x).toBeLessThan(fixture.selectionBounds.maxX - .3)
      expect(point.y).toBeGreaterThan(fixture.selectionBounds.minY + .3)
      expect(point.y).toBeLessThan(fixture.selectionBounds.maxY - .3)
    }
  }
  expect(JSON.stringify(fixture)).toBe(before)
})
