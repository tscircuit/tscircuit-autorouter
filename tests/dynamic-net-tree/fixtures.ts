import type {
  DynamicNetTreeOptions,
  DynamicNetTreeProblem,
} from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
export const options: DynamicNetTreeOptions = {
  gridStep: 0.5,
  viaCost: 3,
  bendCost: 0.05,
  maxExpansions: 300_000,
  maxMilliseconds: 10_000,
}
export function teeProblem(): DynamicNetTreeProblem {
  return {
    net: "N",
    layerCount: 2,
    allowBlindAndBuriedVias: false,
    terminals: [
      { id: "A", point: { x: 0, y: 0 }, layers: [0] },
      { id: "B", point: { x: 10, y: 0 }, layers: [0] },
      { id: "C", point: { x: 5, y: 12 }, layers: [0] },
    ],
    copper: [],
    bounds: { minX: -3, minY: -3, maxX: 16, maxY: 16 },
    outline: [
      { x: -3, y: -3 },
      { x: 16, y: -3 },
      { x: 16, y: 16 },
      { x: -3, y: 16 },
    ],
    width: 0.2,
    clearance: 0.2,
    boardEdgeClearance: 0.2,
    viaDiameter: 0.6,
    viaHoleDiameter: 0.3,
    holeClearance: 0.2,
    allowViaInPad: false,
  }
}
