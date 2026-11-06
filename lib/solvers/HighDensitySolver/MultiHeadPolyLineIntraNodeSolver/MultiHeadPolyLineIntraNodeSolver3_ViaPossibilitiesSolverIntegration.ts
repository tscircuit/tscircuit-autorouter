import { distance } from "@tscircuit/math-utils"
import {
  type PrecomputedViaPossibilitiesProblem,
  ViaPossibilitiesSolver2,
} from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import { MultiHeadPolyLineIntraNodeSolver } from "./MultiHeadPolyLineIntraNodeSolver"
import { MHPoint, PolyLine, Candidate } from "./types1"
import { PolyLine2 } from "./types2"
import { MultiHeadPolyLineIntraNodeSolver2 } from "./MultiHeadPolyLineIntraNodeSolver2_Optimized"

const hashPolyLines = (polyLines: PolyLine2[]): string => {
  const labels = new Array<string>(polyLines.length)
  for (let i = 0; i < polyLines.length; i++) {
    const pl = polyLines[i]!
    const mPoints = pl.mPoints
    let pointsStr = ""
    for (let j = 0; j < mPoints.length; j++) {
      const mp = mPoints[j]!
      if (j > 0) pointsStr += ","
      pointsStr += `${mp.x.toFixed(2)},${mp.y.toFixed(2)},${mp.z1},${mp.z2}`
    }
    labels[i] = `${pl.connectionName}-${pointsStr}`
  }
  labels.sort()
  return labels.join("|")
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
  private precomputedViaProblem?: PrecomputedViaPossibilitiesProblem
  private cachedNodeWithPortPointsRef?: typeof this.nodeWithPortPoints
  private lastCreatedPolylineHash?: string

  override getSolverName(): string {
    return "MultiHeadPolyLineIntraNodeSolver3"
  }

  constructor(
    params: ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver2>[0],
  ) {
    super(params)
    this.MAX_ITERATIONS = 1000
  }

  private getPrecomputedViaProblem(): PrecomputedViaPossibilitiesProblem {
    if (
      !this.precomputedViaProblem ||
      this.cachedNodeWithPortPointsRef !== this.nodeWithPortPoints
    ) {
      this.precomputedViaProblem =
        ViaPossibilitiesSolver2.createPrecomputedProblem(
          this.nodeWithPortPoints,
        )
      this.cachedNodeWithPortPointsRef = this.nodeWithPortPoints
    }
    return this.precomputedViaProblem
  }

  createInitialCandidateFromSeed(
    shuffleSeed: number,
    retainedPolylineHashes?: ReadonlySet<string>,
  ): Candidate | null {
    this.lastCreatedPolylineHash = undefined
    // 1. Run ViaPossibilitiesSolver2 to get a valid path layout
    const viaSolver = new ViaPossibilitiesSolver2({
      nodeWithPortPoints: this.nodeWithPortPoints,
      colorMap: this.colorMap,
      // Pass relevant hyperparameters if needed, e.g., shuffle seed
      hyperParameters: {
        SHUFFLE_SEED: shuffleSeed,
      },
      viaDiameter: this.viaDiameter,
      precomputedProblem: this.getPrecomputedViaProblem(),
    })

    viaSolver.solve()

    if (viaSolver.failed || !viaSolver.solved) {
      this.failed = true
      this.error = `ViaPossibilitiesSolver2 failed with: ${viaSolver.error}`
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

      const startPoint = pathPoints[0]!
      const endPoint = pathPoints[pathPoints.length - 1]!
      const middleEndIndex = pathPoints.length - 1

      const mPoints: MHPoint[] = []
      let currentViaCount = 0

      // Convert Point3[] to MHPoint[] and identify vias
      // The ViaPossibilitiesSolver2 path structure is [start, p1_z1, p1_z2, p2_z2, ..., end]
      // We need to map this to MHPoint structure { x, y, z1, z2 }
      let lastZ = startPoint.z
      for (let i = 1; i < middleEndIndex; i++) {
        const currentRawPoint = pathPoints[i]!
        const nextRawPoint =
          i + 1 < middleEndIndex ? pathPoints[i + 1]! : endPoint // Look ahead to determine z2

        const isViaStart =
          i + 1 < middleEndIndex &&
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
        let bestX1 = 0
        let bestY1 = 0
        let bestZ2 = startPoint.z
        let bestX2 = 0
        let bestY2 = 0
        const totalPoints = mPoints.length + 2

        for (let k = 0; k < totalPoints - 1; k++) {
          const segP1 =
            k === 0
              ? startPoint
              : k - 1 < mPoints.length
                ? mPoints[k - 1]!
                : endPoint
          const segP2 = k + 1 === totalPoints - 1 ? endPoint : mPoints[k]!

          // Skip via segments (where only Z changes)
          if (segP1.x === segP2.x && segP1.y === segP2.y) {
            continue
          }

          const len = distance(segP1, segP2)
          if (len > longestSegmentLength) {
            longestSegmentLength = len
            longestSegmentIndex = k
            bestX1 = segP1.x
            bestY1 = segP1.y
            bestZ2 = k === 0 ? startPoint.z : mPoints[k - 1]!.z2
            bestX2 = segP2.x
            bestY2 = segP2.y
          }
        }

        if (longestSegmentIndex === -1) {
          // Should not happen if there are non-via segments and targetSegmentCount > currentSegments
          console.warn(
            `Could not find longest segment for ${connectionName} while trying to reach ${targetSegmentCount} segments.`,
          )
          break // Exit loop to prevent infinite loop
        }

        // Calculate midpoint and determine segment layer
        const midX = (bestX1 + bestX2) / 2
        const midY = (bestY1 + bestY2) / 2
        const segmentZ = bestZ2

        const newMPoint: MHPoint = {
          x: midX,
          y: midY,
          z1: segmentZ, // New point is on the same layer
          z2: segmentZ,
        }

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

    // Setup retains only the first candidate for each existing geometry hash.
    // Check completed geometry before computing scores for discarded seeds.
    if (retainedPolylineHashes) {
      const preScoreHash = hashPolyLines(polyLines)
      if (retainedPolylineHashes.has(preScoreHash)) return null
      this.lastCreatedPolylineHash = preScoreHash
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
    const canRejectBeforeScoring =
      this.createInitialCandidateFromSeed ===
        nativeCreateInitialCandidateFromSeed &&
      this.computeMinGapBtwPolyLines === nativeComputeMinGapBtwPolyLines &&
      this.computeH === nativeComputeH &&
      this.computeG === nativeComputeG
    for (let i = 0; i < maxCandidatesToGenerate; i++) {
      const newCandidate = canRejectBeforeScoring
        ? this.createInitialCandidateFromSeed(i, candidatePolylineHashes)
        : this.createInitialCandidateFromSeed(i)
      if (!newCandidate) continue
      const newCandidatePolylineHash =
        canRejectBeforeScoring && this.lastCreatedPolylineHash !== undefined
          ? this.lastCreatedPolylineHash
          : hashPolyLines(newCandidate.polyLines)
      if (candidatePolylineHashes.has(newCandidatePolylineHash)) continue
      candidatePolylineHashes.add(newCandidatePolylineHash)
      this.candidates.push(newCandidate)
    }
    this.candidates.sort((a, b) => a.f - b.f) // Sort in case we add more initial candidates later
  }
}

const nativeCreateInitialCandidateFromSeed =
  MultiHeadPolyLineIntraNodeSolver3.prototype.createInitialCandidateFromSeed
const nativeComputeMinGapBtwPolyLines =
  MultiHeadPolyLineIntraNodeSolver.prototype.computeMinGapBtwPolyLines
const nativeComputeH = MultiHeadPolyLineIntraNodeSolver2.prototype.computeH
const nativeComputeG = MultiHeadPolyLineIntraNodeSolver2.prototype.computeG
