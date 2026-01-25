import {
  segmentToSegmentMinDistance,
  pointToSegmentClosestPoint,
} from "@tscircuit/math-utils"
import { PolyLine2, MHPoint2, Candidate2 } from "./types2"
import { MultiHeadPolyLineIntraNodeSolver } from "./MultiHeadPolyLineIntraNodeSolver"

export class MultiHeadPolyLineIntraNodeSolver2 extends MultiHeadPolyLineIntraNodeSolver {
  override getSolverName(): string {
    return "MultiHeadPolyLineIntraNodeSolver2"
  }

  computeG(polyLines: any, candidate: any) {
    return candidate.g + 0.000005 + candidate.viaCount * 0.000005 * 100
  }

  /**
   * We don't use the heuristic because we don't queue new candidates with this
   * solver
   */
  computeH(candidate: any) {
    const { minGaps } = candidate
    let collisionScore = 0
    for (const gap of minGaps) {
      if (gap < 0) {
        collisionScore += this.obstacleMargin
      }
      if (gap < this.obstacleMargin) {
        collisionScore += this.obstacleMargin - gap
      }
    }
    return collisionScore * 0.011 // 100 iterations @ hdpolyline09_optimized
  }

  _step() {
    if (this.phase === "setup") {
      this.setupInitialPolyLines()
      this.phase = "solving"
      return
    }

    const currentCandidate = this.candidates.shift()
    if (!currentCandidate) {
      this.tryFinalAcceptance()
      if (this.solved) return
      this.failed = true
      return
    }
    this.lastCandidate = currentCandidate

    if (this.checkIfSolved(currentCandidate)) {
      this.solved = true
      this._setSolvedRoutes()
      return
    }

    // Apply forces iteratively to the current candidate
    let lastStepMoved = false
    let magForceApplied = 0
    // First run we just do a single step to get the force applied for h
    // computation
    const stepsToRun = currentCandidate.magForceApplied === undefined ? 1 : 10
    for (let step = 0; step < stepsToRun; step++) {
      const result = this.applyForcesToPolyLines(currentCandidate.polyLines)
      magForceApplied += result.magForceApplied
      lastStepMoved = result.lastStepMoved
      if (!result.lastStepMoved) break
    }
    currentCandidate.magForceApplied = magForceApplied

    currentCandidate.minGaps = this.computeMinGapBtwPolyLines(
      currentCandidate.polyLines,
    )

    if (this.checkIfSolved(currentCandidate)) {
      this.solved = true
      this._setSolvedRoutes()
      return
    }

    currentCandidate.g = this.computeG(
      currentCandidate.polyLines,
      currentCandidate,
    )
    currentCandidate.h = this.computeH(currentCandidate)
    currentCandidate.f = currentCandidate.g + currentCandidate.h

    if (lastStepMoved) {
      this.insertCandidate(currentCandidate)
    }
  }

  /**
   * Applies repulsive forces between polylines (segments and vias) and boundary forces
   * directly modifying the input polyLines array.
   * Returns true if any mPoint was moved, false otherwise.
   */
  applyForcesToPolyLines(polyLines: PolyLine2[]): {
    lastStepMoved: boolean
    magForceApplied: number
  } {
    let magForceApplied = 0
    const numPolyLines = polyLines.length
    const FORCE_MAGNITUDE = 0.02 // Tunable parameter for force strength
    const VIA_FORCE_MULTIPLIER = 2.0 // Vias push harder
    const INSIDE_VIA_FORCE_MULTIPLIER = 4.0 // Extra multiplier when inside a via
    const SEGMENT_FORCE_MULTIPLIER = 1.0
    // const FORCE_DECAY_RATE = 1.0 / this.cellSize // Controls how quickly force falls off with distance (adjust as needed)
    const FORCE_DECAY_RATE = 6
    const BOUNDARY_FORCE_STRENGTH = 0.008 // How strongly points are pushed back into bounds
    const EPSILON = 1e-6 // To avoid division by zero

    // 1. Initialize net forces structure: netForces[lineIdx][mPointIdx] = {fx, fy}
    const netForces: Array<Array<{ fx: number; fy: number }>> = Array.from(
      { length: numPolyLines },
      (_, i) =>
        Array.from({ length: polyLines[i].mPoints.length }, () => ({
          fx: 0,
          fy: 0,
        })),
    )

    // Helper to add force directly to the netForces array for a given mPoint index
    const addNetForce = (
      lineIndex: number,
      pointIndexInFullPath: number, // Index in [start, ...mPoints, end]
      fx: number,
      fy: number,
    ) => {
      // Only apply force if the target point is an mPoint (not start or end)
      if (
        pointIndexInFullPath > 0 &&
        pointIndexInFullPath < polyLines[lineIndex].mPoints.length + 1
      ) {
        const mPointIndex = pointIndexInFullPath - 1
        netForces[lineIndex][mPointIndex].fx += fx
        netForces[lineIndex][mPointIndex].fy += fy
      }
    }

    // 2. Calculate forces between all pairs of polylines

    // Helper to process one endpoint against the opposite segment
    const endpointForce = (
      ep: MHPoint2,
      epIdx: number,
      otherSeg: { p1: MHPoint2; p2: MHPoint2; p1Idx: number; p2Idx: number },
      targetLine: number,
      oppLine: number,
      // srcIdOpp: string, // Not needed with addNetForce
      // srcIdThis: string, // Not needed with addNetForce
    ) => {
      const cp = pointToSegmentClosestPoint(ep, otherSeg.p1, otherSeg.p2)
      const dx = ep.x - cp.x
      const dy = ep.y - cp.y
      const dSq = dx * dx + dy * dy
      if (dSq <= EPSILON) return
      const dist = Math.sqrt(dSq)
      const mag =
        SEGMENT_FORCE_MULTIPLIER *
        FORCE_MAGNITUDE *
        Math.exp(-FORCE_DECAY_RATE * dist)
      const fx = (dx / dist) * mag
      const fy = (dy / dist) * mag

      // push this endpoint
      addNetForce(targetLine, epIdx, fx, fy)
      // equal & opposite distributed onto the two endpoints of the other seg
      addNetForce(oppLine, otherSeg.p1Idx, -fx / 2, -fy / 2)
      addNetForce(oppLine, otherSeg.p2Idx, -fx / 2, -fy / 2)
    }

    for (let i = 0; i < numPolyLines; i++) {
      for (let j = i + 1; j < numPolyLines; j++) {
        const polyLine1 = polyLines[i]
        const polyLine2 = polyLines[j]

        const points1 = [polyLine1.start, ...polyLine1.mPoints, polyLine1.end]
        const points2 = [polyLine2.start, ...polyLine2.mPoints, polyLine2.end]

        // Extract segments and vias for easier processing
        const segments1: Array<{
          p1: MHPoint2
          p2: MHPoint2
          layer: number
          p1Idx: number
          p2Idx: number
        }> = []
        const vias1: Array<{
          point: MHPoint2
          layers: number[]
          index: number
        }> = []
        for (let k = 0; k < points1.length - 1; k++) {
          segments1.push({
            p1: points1[k],
            p2: points1[k + 1],
            layer: points1[k].z2,
            p1Idx: k,
            p2Idx: k + 1,
          })
        }
        points1.forEach((p, k) => {
          if (p.z1 !== p.z2)
            vias1.push({ point: p, layers: [p.z1, p.z2], index: k })
        })

        const segments2: Array<{
          p1: MHPoint2
          p2: MHPoint2
          layer: number
          p1Idx: number
          p2Idx: number
        }> = []
        const vias2: Array<{
          point: MHPoint2
          layers: number[]
          index: number
        }> = []
        for (let k = 0; k < points2.length - 1; k++) {
          segments2.push({
            p1: points2[k],
            p2: points2[k + 1],
            layer: points2[k].z2,
            p1Idx: k,
            p2Idx: k + 1,
          })
        }
        points2.forEach((p, k) => {
          if (p.z1 !== p.z2)
            vias2.push({ point: p, layers: [p.z1, p.z2], index: k })
        })

        // --- Interaction Calculations ---

        // a) Segment <-> Segment
        for (const seg1 of segments1) {
          for (const seg2 of segments2) {
            if (seg1.layer === seg2.layer) {
              const minDist = segmentToSegmentMinDistance(
                seg1.p1,
                seg1.p2,
                seg2.p1,
                seg2.p2,
              )
              // endpoints of s1 against s2
              endpointForce(seg1.p1, seg1.p1Idx, seg2, i, j)
              endpointForce(seg1.p2, seg1.p2Idx, seg2, i, j)
              // endpoints of s2 against s1
              endpointForce(seg2.p1, seg2.p1Idx, seg1, j, i)
              endpointForce(seg2.p2, seg2.p2Idx, seg1, j, i)
            }
          }
        }

        // b) Via <-> Segment
        for (const via1 of vias1) {
          for (const seg2 of segments2) {
            if (via1.layers.includes(seg2.layer)) {
              const closestPointOnSeg = pointToSegmentClosestPoint(
                via1.point,
                seg2.p1,
                seg2.p2,
              )
              const dx = via1.point.x - closestPointOnSeg.x
              const dy = via1.point.y - closestPointOnSeg.y
              const dSq = dx * dx + dy * dy

              if (dSq > EPSILON) {
                const dist = Math.sqrt(dSq)
                let forceMultiplier = VIA_FORCE_MULTIPLIER
                let effectiveDistance = dist

                if (dist < this.viaDiameter / 2) {
                  // Point is inside the via radius
                  forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
                  // Use distance from center directly for decay calculation
                  effectiveDistance = Math.max(EPSILON, dist)
                } else {
                  // Point is outside the via radius
                  // Calculate distance from the edge
                  effectiveDistance = Math.max(
                    EPSILON,
                    dist - this.viaDiameter / 2,
                  )
                }

                // Force applied ONLY to the via (i) by the segment (j) - Exponential falloff
                const forceMag =
                  forceMultiplier *
                  FORCE_MAGNITUDE *
                  Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
                const fx_j_on_i = (dx / dist) * forceMag // Direction is still based on center-to-point vector
                const fy_j_on_i = (dy / dist) * forceMag

                // Force applied ONLY to the via (i) by the segment (j)
                addNetForce(i, via1.index, fx_j_on_i, fy_j_on_i)

                // Force from via1 (i) onto seg2 (j) - Apply opposite force to segment endpoints
                addNetForce(j, seg2.p1Idx, -fx_j_on_i / 2, -fy_j_on_i / 2)
                addNetForce(j, seg2.p2Idx, -fx_j_on_i / 2, -fy_j_on_i / 2)
              }
            }
          }
        }
        for (const via2 of vias2) {
          for (const seg1 of segments1) {
            if (via2.layers.includes(seg1.layer)) {
              const closestPointOnSeg = pointToSegmentClosestPoint(
                via2.point,
                seg1.p1,
                seg1.p2,
              )
              const dx = via2.point.x - closestPointOnSeg.x
              const dy = via2.point.y - closestPointOnSeg.y
              const dSq = dx * dx + dy * dy

              if (dSq > EPSILON) {
                const dist = Math.sqrt(dSq)
                let forceMultiplier = VIA_FORCE_MULTIPLIER
                let effectiveDistance = dist

                if (dist < this.viaDiameter / 2) {
                  // Point is inside the via radius
                  forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
                  // Use distance from center directly for decay calculation
                  effectiveDistance = Math.max(EPSILON, dist)
                } else {
                  // Point is outside the via radius
                  // Calculate distance from the edge
                  effectiveDistance = Math.max(
                    EPSILON,
                    dist - this.viaDiameter / 2,
                  )
                }

                // Force applied ONLY to the via (j) by the segment (i) - Exponential falloff
                const forceMag =
                  forceMultiplier *
                  FORCE_MAGNITUDE *
                  Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
                const fx_i_on_j = (dx / dist) * forceMag // Direction is still based on center-to-point vector
                const fy_i_on_j = (dy / dist) * forceMag

                // Force applied ONLY to the via (j) by the segment (i)
                addNetForce(j, via2.index, fx_i_on_j, fy_i_on_j)

                // Force from via2 (j) onto seg1 (i) - Apply opposite force to segment endpoints
                addNetForce(i, seg1.p1Idx, -fx_i_on_j / 2, -fy_i_on_j / 2)
                addNetForce(i, seg1.p2Idx, -fx_i_on_j / 2, -fy_i_on_j / 2)
              }
            }
          }
        }

        // c) Via <-> Via
        for (const via1 of vias1) {
          for (const via2 of vias2) {
            const commonLayers = via1.layers.filter((z) =>
              via2.layers.includes(z),
            )
            if (commonLayers.length > 0) {
              const dx = via1.point.x - via2.point.x
              const dy = via1.point.y - via2.point.y
              const dSq = dx * dx + dy * dy

              if (dSq > EPSILON) {
                const dist = Math.sqrt(dSq)
                let forceMultiplier = VIA_FORCE_MULTIPLIER
                let effectiveDistance = dist

                if (dist < this.viaDiameter) {
                  // Vias overlap
                  forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
                  // Use center-to-center distance directly for decay calculation
                  effectiveDistance = Math.max(EPSILON, dist)
                } else {
                  // Vias do not overlap
                  // Calculate distance between edges
                  effectiveDistance = Math.max(EPSILON, dist - this.viaDiameter)
                }

                // Exponential falloff
                const forceMag =
                  forceMultiplier *
                  FORCE_MAGNITUDE *
                  Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
                const fx_j_on_i = (dx / dist) * forceMag // Force applied by via2 (j) onto via1 (i)
                const fy_j_on_i = (dy / dist) * forceMag

                // Apply force from via2 (j) onto via1 (i)
                addNetForce(i, via1.index, fx_j_on_i, fy_j_on_i)
                // Apply force from via1 (i) onto via2 (j)
                addNetForce(j, via2.index, -fx_j_on_i, -fy_j_on_i)
              }
            }
          }
        }
      }
    }

    // 2.5 Calculate forces between vias WITHIN the SAME polyline
    for (let i = 0; i < numPolyLines; i++) {
      const polyLine = polyLines[i]
      const points = [polyLine.start, ...polyLine.mPoints, polyLine.end]
      const vias: Array<{ point: MHPoint2; layers: number[]; index: number }> =
        []
      points.forEach((p, k) => {
        if (p.z1 !== p.z2)
          vias.push({ point: p, layers: [p.z1, p.z2], index: k })
      })

      if (vias.length < 2) continue // Need at least two vias to interact

      for (let v1Idx = 0; v1Idx < vias.length; v1Idx++) {
        for (let v2Idx = v1Idx + 1; v2Idx < vias.length; v2Idx++) {
          const via1 = vias[v1Idx]
          const via2 = vias[v2Idx]

          // Vias on the same polyline always interact (repel) regardless of layer
          const dx = via1.point.x - via2.point.x
          const dy = via1.point.y - via2.point.y
          const dSq = dx * dx + dy * dy

          if (dSq > EPSILON) {
            const dist = Math.sqrt(dSq)
            let forceMultiplier = VIA_FORCE_MULTIPLIER
            let effectiveDistance = dist

            if (dist < this.viaDiameter) {
              // Vias overlap
              forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
              effectiveDistance = Math.max(EPSILON, dist)
            } else {
              // Vias do not overlap
              effectiveDistance = Math.max(EPSILON, dist - this.viaDiameter)
            }

            // Exponential falloff
            const forceMag =
              forceMultiplier *
              FORCE_MAGNITUDE *
              Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
            const fx_2_on_1 = (dx / dist) * forceMag // Force applied by via2 onto via1
            const fy_2_on_1 = (dy / dist) * forceMag

            // Apply force from via2 onto via1 (both on line i)
            addNetForce(i, via1.index, fx_2_on_1, fy_2_on_1)
            // Apply force from via1 onto via2 (both on line i) - opposite direction
            addNetForce(i, via2.index, -fx_2_on_1, -fy_2_on_1)
          }
        }
      }
    }

    // 3. Apply forces directly to the input polyLines
    let pointsMoved = false
    for (let i = 0; i < numPolyLines; i++) {
      for (let k = 0; k < polyLines[i].mPoints.length; k++) {
        const mPoint = polyLines[i].mPoints[k]
        const netForce = netForces[i][k] // Get the pre-calculated net force

        // No need to sum contributions here anymore

        const isVia = mPoint.z1 !== mPoint.z2
        let currentForceX = netForce.fx // Start with the repulsive/attractive force
        let currentForceY = netForce.fy
        let newX = mPoint.x + currentForceX
        let newY = mPoint.y + currentForceY

        if (isVia) {
          // Apply exponential boundary force ONLY to vias
          const radius = this.viaDiameter / 2
          let boundaryForceX = 0
          let boundaryForceY = 0

          // Use a margin appropriate for vias pushing away from the edge
          const baseForceMargin = this.viaDiameter / 2
          const forceMargin = baseForceMargin + this.BOUNDARY_PADDING

          const minX = this.bounds.minX + forceMargin
          const maxX = this.bounds.maxX - forceMargin
          const minY = this.bounds.minY + forceMargin
          const maxY = this.bounds.maxY - forceMargin

          const distOutsideMinX = minX + radius - mPoint.x // How far the via *center* is past the allowed edge
          const distOutsideMaxX = mPoint.x - (maxX - radius)
          const distOutsideMinY = minY + radius - mPoint.y
          const distOutsideMaxY = mPoint.y - (maxY - radius)

          if (distOutsideMinX > 0) {
            boundaryForceX =
              BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMinX / (this.obstacleMargin * 2)) - 1)
          } else if (distOutsideMaxX > 0) {
            boundaryForceX =
              -BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMaxX / (this.obstacleMargin * 2)) - 1)
          }

          if (distOutsideMinY > 0) {
            boundaryForceY =
              BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMinY / (this.obstacleMargin * 2)) - 1)
          } else if (distOutsideMaxY > 0) {
            boundaryForceY =
              -BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMaxY / (this.obstacleMargin * 2)) - 1)
          }

          // Add boundary force to the current force being considered for this step
          currentForceX += boundaryForceX
          currentForceY += boundaryForceY
          newX = mPoint.x + currentForceX
          newY = mPoint.y + currentForceY

          // Optional: Clamp via position as a hard stop if force isn't enough?
          // newX = Math.max(this.bounds.minX + radius, Math.min(this.bounds.maxX - radius, newX));
          // newY = Math.max(this.bounds.minY + radius, Math.min(this.bounds.maxY - radius, newY));
        } else {
          // For regular points, CLAMP position to bounds + traceWidth/2 padding
          const basePadding = this.traceWidth / 2
          const padding = basePadding + this.BOUNDARY_PADDING
          newX = Math.max(
            this.bounds.minX + padding,
            Math.min(this.bounds.maxX - padding, newX),
          )
          newY = Math.max(
            this.bounds.minY + padding,
            Math.min(this.bounds.maxY - padding, newY),
          )
        }

        // Dampen force? Add friction? (Optional) - Applied before clamping/boundary force

        // Check if the *total applied force* (including boundary) is significant
        if (
          Math.abs(currentForceX) < EPSILON &&
          Math.abs(currentForceY) < EPSILON
        ) {
          continue // No significant force applied in this step, skip update
        }

        // Limit maximum movement per step? (Optional)
        // const maxMove = this.cellSize;
        const forceMag = Math.sqrt(
          currentForceX * currentForceX + currentForceY * currentForceY,
        )
        magForceApplied += forceMag
        // Update position if moved significantly from original position
        // Use the calculated (and potentially clamped/boundary-forced) newX, newY
        if (
          Math.abs(mPoint.x - newX) > EPSILON ||
          Math.abs(mPoint.y - newY) > EPSILON
        ) {
          mPoint.x = newX
          mPoint.y = newY
          pointsMoved = true
        }
      }
      // Recompute hash after potential modifications
    }

    // Return whether any points actually moved
    return { lastStepMoved: pointsMoved, magForceApplied }
  }
}
