import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import {
  futureGeometrySolver,
  referenceFutureTraceQuery,
} from "./futureGeometryTestUtils"

test("future geometry broad phase preserves projection arithmetic across finite magnitudes", (): void => {
  const solver = futureGeometrySolver([])
  const query: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  let state = 701
  const random = (): number => {
    const multiplier = 1664525
    const increment = 1013904223
    state = (Math.imul(state, multiplier) + increment) >>> 0
    const fraction = state / 2 ** 32
    return fraction
  }
  solver.viaDiameter = 0
  solver.traceThickness = 0
  for (let index = 0; index < 8192; index++) {
    const scale = 2 ** (Math.floor(random() * 2000) - 1000)
    const start = { x: (random() - 0.5) * scale, y: (random() - 0.5) * scale, z: 0 }
    const end = { x: (random() - 0.5) * scale, y: (random() - 0.5) * scale, z: 1 }
    const t = random()
    const radius = random() * scale * (index % 2 ? Number.EPSILON : 0.1)
    solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = radius
    solver.futureConnectionSegmentsCache = [{ connectionName: "projection", start, end }]
    query.x = start.x + t * (end.x - start.x)
    query.y = start.y + t * (end.y - start.y) + radius
    expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(
      referenceFutureTraceQuery(solver, query),
    )
  }
})
