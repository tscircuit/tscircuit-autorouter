import { Point3, distance } from "@tscircuit/math-utils"
import { ViaPossibilitiesSolver2 } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import { MultiHeadPolyLineIntraNodeSolver } from "./MultiHeadPolyLineIntraNodeSolver"
import { MHPoint, PolyLine, Candidate } from "./types1"
import { PolyLine2 } from "./types2"
import { MultiHeadPolyLineIntraNodeSolver2 } from "./MultiHeadPolyLineIntraNodeSolver2_Optimized"

const hashPolyLines = (polyLines: PolyLine2[]) => {
  return polyLines
    .flatMap(
      (pl) =>
        `${pl.connectionName}-${pl.mPoints.map((mp) => `${mp.x.toFixed(2)},${mp.y.toFixed(2)},${mp.z1},${mp.z2}`)}`,
    )
    .sort()
    .join("|")
}

function factorial(n: number) {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError("n must be a non-negative integer")
  }
  let result = 1
  for (let i = 2; i <= n; i++) {
    result *= i
  }
  return result
}

export class MultiHeadPolyLineIntraNodeSolver3 extends MultiHeadPolyLineIntraNodeSolver2 {
  constructor(
    params: ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver2>[0],
  ) {
    super(params)
    this.MAX_ITERATIONS = 1000
  }

  createInitialCandidateFromSeed(shuffleSeed: number): Candidate | null {
    // 1. Run ViaPossibilitiesSolver2 to get a valid path layout
    const viaSolver = new ViaPossibilitiesSolver2({
      nodeWithPortPoints: this.nodeWithPortPoints,
      colorMap: this.colorMap,
      // Pass relevant hyperparameters if needed, e.g., shuffle seed
      hyperParameters: {
        SHUFFLE_SEED: shuffleSeed,
      },
      viaDiameter: this.viaDiameter,
    })

    viaSolver.solve()

    if (viaSolver.failed || !viaSolver.solved) {
      return null
    }

    // 2. Convert the completedPaths from ViaPossibilitiesSolver2 into PolyLine[]
    const polyLines: PolyLine[] = []
    let totalViaCount = 0

    for (const [
      connectionName,
      pathPoints,
    ] of viaSolver.completedPaths.entries()) {
      if (pathPoints.length < 2) {
        console.warn(
          `Skipping connection "${connectionName}" due to insufficient points (${pathPoints.length}) in ViaPossibilitiesSolver2 path.`,
        )
        continue // Should not happen with a valid solution
      }

      const startPoint = pathPoints[0]
      const endPoint = pathPoints[pathPoints.length - 1]
      const middlePointsRaw = pathPoints.slice(1, -1)

      const mPoints: MHPoint[] = []
      let currentViaCount = 0

      // Convert Point3[] to MHPoint[] and identify vias
      // The ViaPossibilitiesSolver2 path structure is [start, p1_z1, p1_z2, p2_z2, ..., end]
      // We need to map this to MHPoint structure { x, y, z1, z2 }
      let lastZ = startPoint.z
      for (let i = 0; i < middlePointsRaw.length; i++) {
        const currentRawPoint = middlePointsRaw[i]
        const nextRawPoint =
          i + 1 < middlePointsRaw.length ? middlePointsRaw[i + 1] : endPoint // Look ahead to determine z2

        const isViaStart =
          i + 1 < middlePointsRaw.length &&
          currentRawPoint.x === nextRawPoint.x &&
          currentRawPoint.y === nextRawPoint.y &&
          currentRawPoint.z !== nextRawPoint.z

        const z1 = lastZ
        const z2 = isViaStart ? nextRawPoint.z : currentRawPoint.z

        mPoints.push({
          x: currentRawPoint.x,
          y: currentRawPoint.y,
          z1: z1,
          z2: z2,
        })

        if (z1 !== z2) {
          currentViaCount++
          // Skip the next point as it's the second part of the via pair
          i++
          lastZ = z2 // Update lastZ after the via transition
        } else {
          lastZ = currentRawPoint.z // Update lastZ for the next segment
        }
      }
      totalViaCount += currentViaCount

      // Ensure the polyline has SEGMENTS_PER_POLYLINE segments by splitting the longest ones
      const targetSegmentCount = this.SEGMENTS_PER_POLYLINE
      let currentSegments = mPoints.length + 1

      while (currentSegments < targetSegmentCount) {
        let longestSegmentLength = -1
        let longestSegmentIndex = -1 // Index of the point *before* the longest segment
        let p1: MHPoint | null = null
        let p2: MHPoint | null = null
        const fullPathPoints = [
          {
            ...startPoint,
            z1: startPoint.z,
            z2: startPoint.z,
            connectionName,
          },
          ...mPoints,
          { ...endPoint, z1: endPoint.z, z2: endPoint.z, connectionName },
        ]

        for (let k = 0; k < fullPathPoints.length - 1; k++) {
          const segP1 = fullPathPoints[k]
          const segP2 = fullPathPoints[k + 1]

          // Skip via segments (where only Z changes)
          if (segP1.x === segP2.x && segP1.y === segP2.y) {
            continue
          }

          const len = distance(segP1, segP2)
          if (len > longestSegmentLength) {
            longestSegmentLength = len
            longestSegmentIndex = k
            p1 = segP1
            p2 = segP2
          }
        }

        if (longestSegmentIndex === -1 || !p1 || !p2) {
          // Should not happen if there are non-via segments and targetSegmentCount > currentSegments
          console.warn(
            `Could not find longest segment for ${connectionName} while trying to reach ${targetSegmentCount} segments.`,
          )
          break // Exit loop to prevent infinite loop
        }

        // Calculate midpoint and determine segment layer
        const midX = (p1.x + p2.x) / 2
        const midY = (p1.y + p2.y) / 2
        // The segment exists on the layer *after* p1's potential via, which is p1.z2
        // This should also be the same as p2.z1 (layer *before* p2's potential via)
        const segmentZ = p1.z2

        const newMPoint: MHPoint = {
          x: midX,
          y: midY,
          z1: segmentZ, // New point is on the same layer
          z2: segmentZ,
        }

        // Insert the new midpoint into the mPoints array
        // longestSegmentIndex is the index of the point *before* the segment,
        // so the new point goes at index `longestSegmentIndex` in mPoints
        // (which corresponds to `longestSegmentIndex + 1` in fullPathPoints)
        mPoints.splice(longestSegmentIndex, 0, newMPoint)
        currentSegments++
      }

      // Create the final PolyLine object with potentially adjusted mPoints
      polyLines.push({
        connectionName,
        start: {
          // Use original start/end points from ViaSolver
          ...startPoint,
          z1: startPoint.z,
          z2: startPoint.z, // Start point is not a via itself
        },
        end: {
          ...endPoint,
          z1: endPoint.z, // End point uses its own Z as z1
          z2: endPoint.z, // End point is not a via itself
        },
        mPoints,
      })
    }

    if (polyLines.length === 0) {
      this.failed = true
      this.error = "No valid polylines generated from ViaPossibilitiesSolver2."
      console.error(this.error)
      return null
    }

    const minGaps = this.computeMinGapBtwPolyLines(polyLines)
    const h = this.computeH({ minGaps, forces: [] }) // Initial forces are zero

    const initialCandidate = {
      polyLines,
      g: 0,
      h: h,
      f: 0 + h, // f = g + h
      viaCount: totalViaCount,
      minGaps,
    }
    initialCandidate.g = this.computeG(polyLines, initialCandidate)
    initialCandidate.f = initialCandidate.g + initialCandidate.h

    return initialCandidate
  }

  setupInitialPolyLines(): void {
    this.candidates = []
    const maxCandidatesToGenerate = Math.min(
      2000,
      factorial(this.uniqueConnections),
    )
    const candidatePolylineHashes = new Set<string>()
    for (let i = 0; i < maxCandidatesToGenerate; i++) {
      const newCandidate = this.createInitialCandidateFromSeed(i)
      if (!newCandidate) continue
      const newCandidatePolylineHash = hashPolyLines(newCandidate.polyLines)
      if (candidatePolylineHashes.has(newCandidatePolylineHash)) continue
      candidatePolylineHashes.add(newCandidatePolylineHash)
      this.candidates.push(newCandidate)
    }
    this.candidates.sort((a, b) => a.f - b.f) // Sort in case we add more initial candidates later
  }
}
