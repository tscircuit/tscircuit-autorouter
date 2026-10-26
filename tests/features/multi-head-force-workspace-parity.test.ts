import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type {
  MHPoint2,
  PolyLine2,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import { isDeepStrictEqual } from "node:util"
import { Frozen142EndpointForceSolver } from "tests/fixtures/Frozen142EndpointForceSolver"

type WorkspaceView = {
  netForces: { fx: number; fy: number }[][]
  geometry: {
    segments: { p1: MHPoint2; p2: MHPoint2 }[]
    vias: { point: MHPoint2; layers: number[]; index: number }[]
  }[]
}

test("two-layer force workspaces retain exact mutable passes and release resized candidate geometry", (): void => {
  const params = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "force-workspace-parity",
      center: { x: 0, y: 0 },
      width: 8,
      height: 8,
      availableZ: [0, 1],
      portPoints: [],
    },
    viaDiameter: 0.3,
  }
  const solver = new MultiHeadPolyLineIntraNodeSolver2(params)
  // Frozen original force accumulation is independent of the workspace.
  const original = new Frozen142EndpointForceSolver(params)
  const workspace = (solver as unknown as { forceWorkspace: WorkspaceView })
    .forceWorkspace
  let seed = 88093
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  let comparisons = 0
  for (let sample = 0; sample < 48; sample++) {
    const scale = [1e-200, 0.001, 0.1, 1, 1e120, 1e200][sample % 6]!
    let actual: PolyLine2[] = Array.from(
      { length: sample % 7 },
      (_, lineIndex): PolyLine2 => {
        const points: MHPoint2[] = Array.from(
          { length: 2 + ((sample + lineIndex) % 7) },
          (_, index): MHPoint2 => ({
            x: (random() - 0.5) * scale,
            y: (random() - 0.5) * scale,
            z1: (lineIndex + index) % 2,
            z2: (lineIndex + index + (index % 2)) % 2,
          }),
        )
        if (sample % 4 === 0 && points.length > 3) points[2] = points[1]!
        if (sample % 13 === 0) points[0]!.x = NaN
        return {
          connectionName: `workspace-${lineIndex}`,
          start: points[0]!,
          end: points.at(-1)!,
          mPoints: points.slice(1, -1),
        }
      },
    )
    let expected = structuredClone(actual)
    let firstForce: object | undefined
    let firstSegment: object | undefined
    let firstVia: object | undefined
    for (let pass = 0; pass < 7; pass++) {
      solver.viaDiameter = original.viaDiameter = 0.2 + pass * 0.03
      solver.BOUNDARY_PADDING = original.BOUNDARY_PADDING =
        pass % 2 === 0 ? 0.05 : -0.05
      expect(
        isDeepStrictEqual(
          solver.applyForcesToPolyLines(actual),
          original.applyForcesToPolyLines(expected),
        ),
      ).toBe(true)
      expect(isDeepStrictEqual(actual, expected)).toBe(true)
      comparisons++
      expect(workspace.netForces.length).toBe(actual.length)
      expect(workspace.geometry.length).toBe(actual.length)
      for (let lineIndex = 0; lineIndex < actual.length; lineIndex++) {
        const line = actual[lineIndex]!
        const points = [line.start, ...line.mPoints, line.end]
        const geometry = workspace.geometry[lineIndex]!
        expect(workspace.netForces[lineIndex]!.length).toBe(line.mPoints.length)
        expect(geometry.segments.length).toBe(points.length - 1)
        for (let index = 0; index < geometry.segments.length; index++) {
          expect(geometry.segments[index]!.p1).toBe(points[index])
          expect(geometry.segments[index]!.p2).toBe(points[index + 1])
        }
        const viaIndexes = points.flatMap((point, index): number[] =>
          point.z1 !== point.z2 ? [index] : [],
        )
        expect(geometry.vias.length).toBe(viaIndexes.length)
        for (let index = 0; index < viaIndexes.length; index++) {
          const pointIndex = viaIndexes[index]!
          const point = points[pointIndex]!
          expect(geometry.vias[index]!.point).toBe(point)
          expect(geometry.vias[index]!.layers).toEqual(solver.availableZ)
          expect(geometry.vias[index]!.index).toBe(pointIndex)
        }
      }
      if (pass === 0) {
        firstForce = workspace.netForces[0]?.[0]
        firstSegment = workspace.geometry[0]?.segments[0]
        firstVia = workspace.geometry[0]?.vias[0]
      } else if (pass === 1) {
        expect(Object.is(workspace.netForces[0]?.[0], firstForce)).toBe(true)
        expect(
          Object.is(workspace.geometry[0]?.segments[0], firstSegment),
        ).toBe(true)
        expect(Object.is(workspace.geometry[0]?.vias[0], firstVia)).toBe(true)
      }

      for (const lines of [actual, expected]) {
        for (const line of lines) {
          for (const point of [line.start, ...line.mPoints, line.end]) {
            point.x += 0.01
            point.y -= 0.02
          }
          if (pass === 1) {
            line.start = { ...line.start, z1: 1, z2: 0 }
            line.end = { ...line.end, z1: 0, z2: 1 }
            line.mPoints.splice(0, 1)
          } else if (pass === 2) {
            line.mPoints.push({ x: -0, y: 0.1, z1: 0, z2: 1 })
            for (const point of line.mPoints) point.z2 = (point.z2 + 1) % 2
          }
        }
      }
      if (pass === 3) {
        actual = structuredClone(actual.reverse())
        expected = structuredClone(expected.reverse())
      } else if (pass === 4) {
        actual = []
        expected = []
      } else if (pass === 5) {
        actual = [
          {
            connectionName: "replacement",
            start: { x: -1, y: 0, z1: 0, z2: 1 },
            end: { x: 1, y: 0, z1: 1, z2: 0 },
            mPoints: [{ x: 0, y: 0.1, z1: 1, z2: 1 }],
          },
        ]
        expected = structuredClone(actual)
      }
    }
  }
  expect(comparisons).toBe(336)
})
