import { expect, test } from 'bun:test'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import fixture from '../fixtures/sample24-hdr77018-physical-world.json'
import { Pipeline9HighDensitySolver } from '../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver'
import { createMandatoryPortPointIndex } from '../../lib/solvers/HighDensitySolver/mandatoryPortPointIndex'
import type { NodeWithPortPoints } from '../../lib/types/high-density-types'
import type { Obstacle } from '../../lib/types/srj-types'

test('actual77018 routes all six tasks by expanding physical search bounds with fixed world ports', () => {
  const before = JSON.stringify(fixture)
  const solver = new Pipeline9HighDensitySolver({
    ...fixture.options, nodePortPoints: [fixture.node] as NodeWithPortPoints[],
    obstacles: fixture.obstacles as Obstacle[], connMap: new ConnectivityMap(fixture.connMap),
    colorMap: {}, fixedHdRoutes: [],
    mandatoryPortPointIndex: createMandatoryPortPointIndex(fixture.actualCohort as NodeWithPortPoints[]),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(6)
  for (const pair of fixture.node.portPointsInPairs) {
    const route = solver.routes.find((r) => r.connectionName === pair[0]!.connectionName)!
    const [start, end] = pair
    expect(route.route[0]).toEqual({ x: start!.x, y: start!.y, z: start!.z })
    expect(route.route.at(-1)).toEqual({ x: end!.x, y: end!.y, z: end!.z })
    expect(route.traceThickness).toBe(.1)
    expect(route.viaDiameter).toBe(.3)
    // Every emitted capsule stays within the independently selected fixture ROI.
    for (const point of route.route) {
      expect(point.x).toBeGreaterThan(fixture.selectionBounds.minX + .3)
      expect(point.x).toBeLessThan(fixture.selectionBounds.maxX - .3)
      expect(point.y).toBeGreaterThan(fixture.selectionBounds.minY + .3)
      expect(point.y).toBeLessThan(fixture.selectionBounds.maxY - .3)
    }
  }
  expect(solver.routes.some((r) => r.route.length > 4)).toBe(true)
  expect(solver.routes.some((r) => r.vias.some((v) => v.x < fixture.node.center.x - fixture.node.width / 2 ||
    v.x > fixture.node.center.x + fixture.node.width / 2 || v.y < fixture.node.center.y - fixture.node.height / 2 ||
    v.y > fixture.node.center.y + fixture.node.height / 2))).toBe(true)
  expect(JSON.stringify(fixture)).toBe(before)
})
