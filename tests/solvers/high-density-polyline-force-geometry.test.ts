import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { applyForcesReference } from "tests/fixtures/polyline-force-reference"

test("per-call polyline geometry preserves every force and point across repeated updates", () => {
  let seed = 72811
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const options = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "force-parity",
      center: { x: 0, y: 0 }, width: 4, height: 4,
      availableZ: [0, 1, 2, 3], portPoints: [],
    },
  }
  for (let sample = 0; sample < 24; sample++) {
    const optimized = new MultiHeadPolyLineIntraNodeSolver2(options)
    const reference = new MultiHeadPolyLineIntraNodeSolver2(options)
    const polyLines: PolyLine2[] = Array.from({ length: sample % 7 }, (_, line) => {
      let layer = line % 4
      const start = { x: -2, y: random() * 4 - 2, z1: layer, z2: layer }
      const mPoints = Array.from({ length: sample % 9 === 0 ? 0 : 2 + line % 4 }, (_, point) => {
        const z1 = layer
        if ((sample + point) % 3 === 0) layer = (layer + 1) % 4
        return {
          x: sample % 5 === 0 ? 0 : random() * 4.2 - 2.1,
          y: sample % 5 === 0 ? 0 : random() * 4.2 - 2.1,
          z1, z2: layer,
        }
      })
      return {
        connectionName: `line-${line}`, start, mPoints,
        end: { x: 2, y: random() * 4 - 2, z1: layer, z2: layer },
      }
    })
    const originalPolyLines = structuredClone(polyLines)
    for (let step = 0; step < 24; step++) {
      if (step === 7) {
        optimized.viaDiameter = reference.viaDiameter = 0.5
      }
      if (step === 11) {
        for (const lines of [polyLines, originalPolyLines]) {
          const point = lines[0]?.mPoints[0]
          if (point) point.z2 = (point.z2 + 1) % 4
        }
      }
      if (step === 15) {
        for (const lines of [polyLines, originalPolyLines]) {
          if (lines[0]) {
            lines[0].mPoints = [
              ...lines[0].mPoints,
              { x: 0.1, y: 0.1, z1: 0, z2: 1 },
            ]
          }
        }
      }
      const actual = optimized.applyForcesToPolyLines(polyLines)
      const expected = applyForcesReference.call(reference, originalPolyLines)
      expect(actual).toEqual(expected)
      expect(polyLines).toEqual(originalPolyLines)
    }
  }
})
