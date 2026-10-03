import { pointToSegmentClosestPoint } from "@tscircuit/math-utils"
import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type {
  MHPoint2,
  PolyLine2,
} from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"

function applyReferenceSegmentForces(
  solver: MultiHeadPolyLineIntraNodeSolver2,
  lines: PolyLine2[],
): { lastStepMoved: boolean; magForceApplied: number } {
  const forces = lines.map((line) => line.mPoints.map(() => ({ x: 0, y: 0 })))
  const paths = lines.map((line) => [line.start, ...line.mPoints, line.end])
  const addForce = (
    lineIndex: number,
    pointIndex: number,
    x: number,
    y: number,
  ): void => {
    const force = forces[lineIndex]![pointIndex - 1]
    if (!force) return
    force.x += x
    force.y += y
  }
  const endpointForce = (
    point: MHPoint2,
    pointIndex: number,
    start: MHPoint2,
    end: MHPoint2,
    segmentIndex: number,
    targetLine: number,
    oppositeLine: number,
  ): void => {
    const closest = pointToSegmentClosestPoint(point, start, end)
    const dx = point.x - closest.x
    const dy = point.y - closest.y
    const squaredDistance = dx * dx + dy * dy
    if (squaredDistance <= 1e-6) return
    const distance = Math.sqrt(squaredDistance)
    const magnitude = 1 * 0.02 * Math.exp(-6 * distance)
    const fx = (dx / distance) * magnitude
    const fy = (dy / distance) * magnitude
    addForce(targetLine, pointIndex, fx, fy)
    addForce(oppositeLine, segmentIndex, -fx / 2, -fy / 2)
    addForce(oppositeLine, segmentIndex + 1, -fx / 2, -fy / 2)
  }

  for (let left = 0; left < paths.length; left++) {
    for (let right = left + 1; right < paths.length; right++) {
      const leftPath = paths[left]!
      const rightPath = paths[right]!
      for (let i = 0; i < leftPath.length - 1; i++) {
        for (let j = 0; j < rightPath.length - 1; j++) {
          const leftStart = leftPath[i]!
          const leftEnd = leftPath[i + 1]!
          const rightStart = rightPath[j]!
          const rightEnd = rightPath[j + 1]!
          if (leftStart.z2 !== rightStart.z2) continue
          endpointForce(leftStart, i, rightStart, rightEnd, j, left, right)
          endpointForce(leftEnd, i + 1, rightStart, rightEnd, j, left, right)
          endpointForce(rightStart, j, leftStart, leftEnd, i, right, left)
          endpointForce(rightEnd, j + 1, leftStart, leftEnd, i, right, left)
        }
      }
    }
  }

  let lastStepMoved = false
  let magForceApplied = 0
  const padding = solver.traceWidth / 2 + solver.BOUNDARY_PADDING
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!
    for (let index = 0; index < line.mPoints.length; index++) {
      const point = line.mPoints[index]!
      const force = forces[lineIndex]![index]!
      const x = Math.max(
        solver.bounds.minX + padding,
        Math.min(solver.bounds.maxX - padding, point.x + force.x),
      )
      const y = Math.max(
        solver.bounds.minY + padding,
        Math.min(solver.bounds.maxY - padding, point.y + force.y),
      )
      if (Math.abs(force.x) < 1e-6 && Math.abs(force.y) < 1e-6) continue
      magForceApplied += Math.sqrt(force.x * force.x + force.y * force.y)
      if (Math.abs(point.x - x) > 1e-6 || Math.abs(point.y - y) > 1e-6) {
        point.x = x
        point.y = y
        lastStepMoved = true
      }
    }
  }
  return { lastStepMoved, magForceApplied }
}

test("precomputed endpoint projections preserve exact forces and point moves", (): void => {
  const solver = new MultiHeadPolyLineIntraNodeSolver2({
    nodeWithPortPoints: {
      capacityMeshNodeId: "endpoint-force-parity",
      center: { x: 0, y: 0 },
      width: 8,
      height: 8,
      availableZ: [0, 1, 2],
      portPoints: [],
    },
  })
  let seed = 71
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let sample = 0; sample < 160; sample++) {
    const scale = [1e-200, 0.001, 0.1, 1, 100][sample % 5]!
    const lines: PolyLine2[] = []
    for (let lineIndex = 0; lineIndex < 4; lineIndex++) {
      const layer = sample % 7 === 0 ? lineIndex % 3 : 0
      const points: MHPoint2[] = []
      for (let index = 0; index < 5; index++) {
        const point = {
          x: (random() - 0.5) * scale,
          y: (random() - 0.5) * scale,
          z1: layer,
          z2: layer,
        }
        // Zero-length segments and duplicate endpoints exercise the helper's
        // exact degeneracy branch, including underflowing squared lengths.
        points.push(
          index > 0 && (sample + lineIndex + index) % 4 === 0
            ? { ...points[index - 1]! }
            : point,
        )
      }
      lines.push({
        connectionName: `line-${lineIndex}`,
        start: points[0]!,
        end: points[4]!,
        mPoints: points.slice(1, -1),
      })
    }
    const expected = structuredClone(lines)
    for (let pass = 0; pass < 6; pass++) {
      expect(solver.applyForcesToPolyLines(lines)).toEqual(
        applyReferenceSegmentForces(solver, expected),
      )
      expect(lines).toEqual(expected)
    }
  }
})
