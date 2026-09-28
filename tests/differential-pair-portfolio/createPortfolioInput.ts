import type {
  PortfolioInput,
  PairStrategy,
} from "../../scripts/differential-pair-portfolio/runPairPortfolio"

export function createPortfolioInput(
  strategies: PairStrategy[],
): PortfolioInput {
  return {
    strategies,
    budgetMs: 10_000,
    params: {
      layerCount: 2,
      bounds: { minX: -5, maxX: 5, minY: -3, maxY: 3 },
      obstacles: [],
      minTraceToPadEdgeClearance: 0.1,
      hdRoutes: [-1, 1].map((sign, index) => ({
        connectionName: index === 0 ? "P" : "N",
        traceThickness: 0.15,
        viaDiameter: 0.5,
        vias: [],
        route: [
          { x: -4, y: sign * 0.3, z: 0 },
          { x: -2, y: sign * 1.2, z: 0 },
          { x: 2, y: sign * 1.2, z: 0 },
          { x: 4, y: sign * 0.3, z: 0 },
        ],
      })),
      differentialPairs: [
        {
          connectionNames: ["P", "N"],
          lengthTolerance: 0.02,
          minimumCenterlineDistance: 0.6,
          maximumCenterlineDistance: 0.6,
          maxUncoupledLength: 1,
        },
      ],
    },
    constraints: [
      { connectionNames: ["P", "N"], traceGap: 0.45, maxUncoupledLength: 1 },
    ],
  }
}
