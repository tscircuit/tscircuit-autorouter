import type { DynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"

/** Abstract the captured GND failure: a cheaper optional transition to a
 * bottom terminal competes with the only site available to an eastern cluster. */
export function sharedViaAllocationFixture(): DynamicNetTreeProblem {
  return {
    net: "N",
    terminals: [
      { id: "root", point: { x: 0, y: 0 }, layers: [0] },
      { id: "bottom", point: { x: 2, y: 0 }, layers: [1] },
      ...[
        { x: 10, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 2 },
        { x: 10, y: 2 },
      ].map((point, i) => ({ id: `east:${i}`, point, layers: [0] })),
    ],
    copper: [
      {
        id: "root-via",
        owner: "N",
        kind: "via",
        layers: [0, 1],
        start: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
        radius: 0.3,
        holeDiameter: 0.3,
      },
      {
        id: "bottom-rise",
        owner: "N",
        kind: "wire",
        layers: [1],
        start: { x: 0, y: 0 },
        end: { x: 0, y: 6 },
        radius: 0.1,
      },
      {
        id: "bottom-bus",
        owner: "N",
        kind: "wire",
        layers: [1],
        start: { x: 0, y: 6 },
        end: { x: 12, y: 6 },
        radius: 0.1,
      },
      {
        id: "top-separator",
        owner: "N_mst0",
        kind: "pad",
        layers: [0],
        start: { x: 5.5, y: 2.5 },
        end: { x: 5.5, y: 2.5 },
        radius: 0,
        rectangle: { width: 1, height: 11, rotation: 0 },
      },
      {
        id: "bottom-detour",
        owner: "F",
        kind: "pad",
        layers: [1],
        start: { x: 1, y: 1.5 },
        end: { x: 1, y: 1.5 },
        radius: 0,
        rectangle: { width: 0.5, height: 7, rotation: 0 },
      },
    ],
    bounds: { minX: -3, minY: -3, maxX: 14, maxY: 8 },
    outline: [
      { x: -3, y: -3 },
      { x: 14, y: -3 },
      { x: 14, y: 8 },
      { x: -3, y: 8 },
    ],
    width: 0.2,
    clearance: 0.2,
    boardEdgeClearance: 0.2,
    viaDiameter: 0.6,
    viaHoleDiameter: 0.3,
    holeClearance: 0.25,
    allowViaInPad: false,
  }
}
