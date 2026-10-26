import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { Frozen142EndpointForceSolver } from "tests/fixtures/Frozen142EndpointForceSolver"

test("MultiHead through-via forces cover the same available layers as clearance gaps", () => {
  for (const layerCount of [4, 8]) {
    for (const scale of [1, 2, 4, 8]) {
      const params = {
        nodeWithPortPoints: {
          capacityMeshNodeId: "through-via-force-span",
          center: { x: 0, y: 0 },
          width: 10 * scale,
          height: 10 * scale,
          availableZ: Array.from({ length: layerCount }, (_, z) => z),
          portPoints: [],
        },
      }
      const solver = new MultiHeadPolyLineIntraNodeSolver2(params)
      for (const [toZ, wireZ] of [
        [layerCount - 1, 1],
        [1, layerCount - 1],
      ]) {
        const lines: PolyLine2[] = [
          {
            connectionName: "via-owner",
            start: { x: -scale, y: 0, z1: 0, z2: 0 },
            end: { x: scale, y: 0, z1: toZ, z2: toZ },
            mPoints: [{ x: 0, y: 0, z1: 0, z2: toZ }],
          },
          {
            connectionName: "foreign-wire",
            start: { x: -scale, y: 0.01 * scale, z1: wireZ, z2: wireZ },
            end: { x: scale, y: 0.01 * scale, z1: wireZ, z2: wireZ },
            mPoints: [
              { x: 0.2 * scale, y: 0.01 * scale, z1: wireZ, z2: wireZ },
            ],
          },
        ]
        const before = structuredClone(lines)
        expect(solver.computeMinGapBtwPolyLines(lines)[0]).toBeLessThan(0)
        const result = solver.applyForcesToPolyLines(lines)
        expect(result.lastStepMoved).toBe(true)
        expect(result.magForceApplied).toBeGreaterThan(0)
        expect(lines[0]!.mPoints[0]!.y).toBeLessThan(before[0]!.mPoints[0]!.y)
        expect(lines[1]!.mPoints[0]!.y).toBeGreaterThan(
          before[1]!.mPoints[0]!.y,
        )
        expect(lines.map(({ start, end }) => ({ start, end }))).toEqual(
          before.map(({ start, end }) => ({ start, end })),
        )
      }
    }
  }

  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "two-layer-force-parity",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ: [0, 1],
      portPoints: [],
    },
  }
  const actualSolver = new MultiHeadPolyLineIntraNodeSolver2(params)
  const reference = new Frozen142EndpointForceSolver(params)
  const lines: PolyLine2[] = [0, 1].map((index) => ({
    connectionName: `foreign-${index}`,
    start: { x: -1, y: index * 0.2, z1: index, z2: index },
    end: { x: 1, y: index * 0.2, z1: 1 - index, z2: 1 - index },
    mPoints: [{ x: index * 0.2, y: index * 0.2, z1: index, z2: 1 - index }],
  }))
  const expected = structuredClone(lines)
  for (const layerCount of [2, 8, 4, 2]) {
    actualSolver.availableZ = Array.from({ length: layerCount }, (_, z) => z)
    expect(actualSolver.applyForcesToPolyLines(lines)).toEqual(
      reference.applyForcesToPolyLines(expected),
    )
    expect(lines).toEqual(expected)
    const workspace = (
      actualSolver as unknown as {
        forceWorkspace: { geometry: { vias: { layers: number[] }[] }[] }
      }
    ).forceWorkspace
    for (const geometry of workspace.geometry) {
      for (const via of geometry.vias) {
        expect(via.layers).toEqual(actualSolver.availableZ)
        expect(via.layers).not.toBe(actualSolver.availableZ)
      }
    }
  }
})
