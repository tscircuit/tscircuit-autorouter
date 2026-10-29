import { expect, test } from "bun:test"
import { PathPackingGeometry, createPathPackingAudit } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { finishPackingGenerator } from "./fixtures/pathPackingSynthetic"

test("continuous mutual copper checks match unchanged published reference predicates on seeded wire/via cases", () => {
  const geometry = new PathPackingGeometry({ node: { capacityMeshNodeId: "parity", center: { x: 0, y: 0 },
    width: 20, height: 20, availableZ: [0, 1], portPoints: [] }, obstacles: [], layerCount: 2,
    traceClearance: 0.1, viaToPadClearance: 0.1, holeClearance: 0.1,
    viaHoleDiameter: 0.15, minimumHoleGap: 0.1 }, createPathPackingAudit())
  let state = 7419
  const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  for (let i = 0; i < 96; i++) {
    const routes: HighDensityRoute[] = [0, 1].map((j) => {
      const x = random() * 1.7 - 0.85, y = random() * 1.7 - 0.85
      return { connectionName: `net_${j}`, traceThickness: 0.1, viaDiameter: 0.3,
        route: (i + j) % 3 === 0
          ? [{ x: x - 0.6, y, z: 0 }, { x, y, z: 0 }, { x, y, z: 1 }, { x: x + 0.6, y, z: 1 }]
          : [{ x: x - 0.6, y: y - 0.3, z: j }, { x: x + 0.6, y: y + 0.3, z: j }],
        vias: (i + j) % 3 === 0 ? [{ x, y }] : [] }
    })
    const board = { layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, obstacles: [],
      connections: routes.map((r) => ({ name: r.connectionName, pointsToConnect: [] })) }
    const full = evaluateRelaxedDrc({ inputSrj: board, srjWithPointPairs: board,
      routedTraces: routes.map((r, j) => ({ type: "pcb_trace", pcb_trace_id: `t${j}`,
        connection_name: r.connectionName, route: convertHdRouteToSimplifiedRoute(r, 2) })),
      drcOptions: { traceClearance: 0.1, viaClearance: 0.1, viaToPadClearance: 0.1, includeTraceContinuity: false } })
    expect(finishPackingGenerator(geometry.conflict(routes[0]!, routes[1]!))).toBe(full.errors.length > 0)
  }
})
