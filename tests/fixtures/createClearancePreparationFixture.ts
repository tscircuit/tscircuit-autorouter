import type { RelaxTraceClearanceInput } from "@tscircuit/repair04"

/** Enough segments to use parallel preparation, with a real movable contact. */
export function createClearancePreparationFixture(): RelaxTraceClearanceInput {
  const bounds = { minX: -2, maxX: 800, minY: -2, maxY: 30 }
  const routes = Array.from({ length: 350 }, (_, index) => ({
    connectionName: `projection-${index}`,
    traceThickness: 0.2,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: 6 }, (_, pointIndex) => ({
      x: (index < 2 ? 0 : index * 2) + pointIndex / 6,
      y: index < 2 ? index * 0.25 : (index % 9) * 2,
      z: 0,
    })),
  }))
  return {
    srj: {
      layerCount: 2,
      minTraceWidth: 0.2,
      obstacles: [],
      bounds,
      connections: [],
    },
    bounds,
    boundaryMargin: 0,
    routes,
    lockedPointIndices: routes.map((route) => route.route.map(() => false)),
    traceClearance: 0.1,
    viaClearance: 0.1,
  }
}
