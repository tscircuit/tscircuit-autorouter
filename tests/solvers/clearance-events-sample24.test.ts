import { expect, test } from 'bun:test'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import fixture from '../fixtures/sample24-hdr77473-clearance-events.json'
import { Pipeline9HighDensitySolver } from '../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver'
import { createMandatoryPortPointIndex } from '../../lib/solvers/HighDensitySolver/mandatoryPortPointIndex'
import type { NodeWithPortPoints } from '../../lib/types/high-density-types'
import type { Obstacle } from '../../lib/types/srj-types'

test('actual77473 combines clearance event coordinates to reach a certified through-via gap', () => {
  const before = JSON.stringify(fixture)
  const connMap = new ConnectivityMap(fixture.connMap)
  const solver = new Pipeline9HighDensitySolver({
    ...fixture.options,
    nodePortPoints: [fixture.node] as NodeWithPortPoints[],
    obstacles: fixture.obstacles as Obstacle[],
    connMap,
    colorMap: {},
    fixedHdRoutes: [],
    mandatoryPortPointIndex: createMandatoryPortPointIndex(fixture.actualCohort as NodeWithPortPoints[]),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routes).toHaveLength(1)
  const route = solver.routes[0]!
  expect(route.vias).toHaveLength(1)
  expect(route.traceThickness).toBe(.1)
  expect(route.viaDiameter).toBe(.3)
  const [start, end] = fixture.node.portPoints
  expect(route.route[0]).toEqual({ x: start!.x, y: start!.y, z: start!.z })
  expect(route.route.at(-1)).toEqual({ x: end!.x, y: end!.y, z: end!.z })
  const via = route.vias[0]!
  const own = connMap.getNetConnectedToId(route.connectionName)
  for (const node of fixture.actualCohort) for (const point of node.portPoints) {
    if (connMap.getNetConnectedToId(point.connectionName) === own) continue
    expect(Math.hypot(via.x - point.x, via.y - point.y)).toBeGreaterThanOrEqual(.3 - 1e-9)
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!, b = route.route[i]!
      if (a.z !== b.z || point.z !== a.z) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)))
      expect(Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)).toBeGreaterThanOrEqual(.2 - 1e-9)
    }
  }
  expect(JSON.stringify(fixture)).toBe(before)
})
