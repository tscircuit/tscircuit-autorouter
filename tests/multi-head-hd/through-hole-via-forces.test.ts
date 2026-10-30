import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"

test("through-hole via forces include intermediate routing layers on repeated passes", (): void => {
  const lines: PolyLine2[] = [
    {
      connectionName: "via-net",
      start: { x: -1, y: 0, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: 0, z1: 0, z2: 1 }],
      end: { x: 1, y: 0, z1: 1, z2: 1 },
    },
    {
      connectionName: "wire-net",
      start: { x: -1, y: 0.25, z1: 2, z2: 2 },
      mPoints: [{ x: 0, y: 0.25, z1: 2, z2: 2 }],
      end: { x: 1, y: 0.25, z1: 2, z2: 2 },
    },
  ]
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "full-via-stack",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1, 2, 3],
      portPoints: [],
    },
    viaDiameter: 0.3,
    traceWidth: 0.1,
  }
  const layerIndices = [0, 1, 2, 3]
  const through = new MultiHeadPolyLineIntraNodeSolver2({
    ...params,
    viaLayerIndices: layerIndices,
  })
  const endpointLayers = new MultiHeadPolyLineIntraNodeSolver2(params)
  const actual = structuredClone(lines)
  const original = structuredClone(lines)
  for (let pass = 0; pass < 3; pass++) {
    through.applyForcesToPolyLines(actual)
    endpointLayers.applyForcesToPolyLines(original)
    expect(actual[0]!.mPoints[0]!.y).toBeLessThan(original[0]!.mPoints[0]!.y)
    expect(actual[1]!.mPoints[0]!.y).toBeGreaterThan(original[1]!.mPoints[0]!.y)
    expect(layerIndices).toEqual([0, 1, 2, 3])
  }
})
