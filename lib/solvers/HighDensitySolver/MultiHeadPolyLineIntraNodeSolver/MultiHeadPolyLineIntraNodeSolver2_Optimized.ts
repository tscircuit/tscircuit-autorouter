import { pointToSegmentClosestPoint } from "@tscircuit/math-utils"
import { PolyLine2, MHPoint2, Candidate2 } from "./types2"
import { MultiHeadPolyLineIntraNodeSolver } from "./MultiHeadPolyLineIntraNodeSolver"

type NetForce = { fx: number; fy: number }

type ForceSegment = {
  p1: MHPoint2
  p2: MHPoint2
  deltaX: number
  deltaY: number
  lengthSquared: number
  layer: number
  p1Idx: number
  p2Idx: number
  p1Force: NetForce | undefined
  p2Force: NetForce | undefined
  lastTargetLine: number
  lastEndpointIndex: number
  lastFx: number
  lastFy: number
  lastForceActive: boolean
}

type ForceVia = {
  point: MHPoint2
  layers: number[]
  index: number
  force: NetForce | undefined
}

type ForceGeometry = {
  segments: ForceSegment[]
  vias: ForceVia[]
}

type ForceWorkspace = {
  netForces: NetForce[][]
  geometry: ForceGeometry[]
}

export class MultiHeadPolyLineIntraNodeSolver2 extends MultiHeadPolyLineIntraNodeSolver {
  private forceWorkspace: ForceWorkspace = { netForces: [], geometry: [] }

  private prepareForceWorkspace(polyLines: PolyLine2[]): ForceWorkspace {
    const { netForces, geometry } = this.forceWorkspace
    // Discard removed lines and points rather than retaining past candidates.
    netForces.length = polyLines.length
    geometry.length = polyLines.length
    for (let lineIndex = 0; lineIndex < polyLines.length; lineIndex++) {
      const polyLine = polyLines[lineIndex]!
      let forces = netForces[lineIndex]
      if (!forces) {
        forces = []
        netForces[lineIndex] = forces
      }
      forces.length = polyLine.mPoints.length
      for (let pointIndex = 0; pointIndex < forces.length; pointIndex++) {
        const force = forces[pointIndex]
        if (force) {
          force.fx = 0
          force.fy = 0
        } else {
          forces[pointIndex] = { fx: 0, fy: 0 }
        }
      }
      let lineGeometry = geometry[lineIndex]
      if (!lineGeometry) {
        lineGeometry = { segments: [], vias: [] }
        geometry[lineIndex] = lineGeometry
      }
      const { segments, vias } = lineGeometry
      const lastPointIndex = polyLine.mPoints.length + 1
      segments.length = lastPointIndex
      let viaCount = 0
      for (let pointIndex = 0; pointIndex <= lastPointIndex; pointIndex++) {
        const point =
          pointIndex === 0
            ? polyLine.start
            : pointIndex === lastPointIndex
              ? polyLine.end
              : polyLine.mPoints[pointIndex - 1]!
        if (pointIndex < lastPointIndex) {
          const nextPoint =
            pointIndex + 1 === lastPointIndex
              ? polyLine.end
              : polyLine.mPoints[pointIndex]!
          const deltaX = nextPoint.x - point.x
          const deltaY = nextPoint.y - point.y
          let segment = segments[pointIndex]
          if (!segment) {
            segment = {
              p1: point,
              p2: nextPoint,
              deltaX,
              deltaY,
              lengthSquared: deltaX * deltaX + deltaY * deltaY,
              layer: point.z2,
              p1Idx: pointIndex,
              p2Idx: pointIndex + 1,
              p1Force: forces[pointIndex - 1],
              p2Force: forces[pointIndex],
              lastTargetLine: -1,
              lastEndpointIndex: -1,
              lastFx: 0,
              lastFy: 0,
              lastForceActive: false,
            }
            segments[pointIndex] = segment
          } else {
            segment.p1 = point
            segment.p2 = nextPoint
            segment.deltaX = deltaX
            segment.deltaY = deltaY
            segment.lengthSquared = deltaX * deltaX + deltaY * deltaY
            segment.layer = point.z2
            segment.p1Idx = pointIndex
            segment.p2Idx = pointIndex + 1
            segment.p1Force = forces[pointIndex - 1]
            segment.p2Force = forces[pointIndex]
            segment.lastTargetLine = -1
            segment.lastEndpointIndex = -1
            segment.lastFx = 0
            segment.lastFy = 0
            segment.lastForceActive = false
          }
        }
        if (point.z1 !== point.z2) {
          let via = vias[viaCount]
          if (!via) {
            via = {
              point,
              layers: [point.z1, point.z2],
              index: pointIndex,
              force: forces[pointIndex - 1],
            }
            vias[viaCount] = via
          } else {
            via.point = point
            via.layers[0] = point.z1
            via.layers[1] = point.z2
            via.index = pointIndex
            via.force = forces[pointIndex - 1]
          }
          viaCount++
        }
      }
      vias.length = viaCount
    }
    return this.forceWorkspace
  }

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
    const { netForces, geometry } = this.prepareForceWorkspace(polyLines)

    // 2. Calculate forces between all pairs of polylines

    // Helper to process one endpoint against the opposite segment
    const endpointForce = (
      ep: MHPoint2,
      epIdx: number,
      otherSeg: ForceSegment,
      targetLine: number,
      targetForce: NetForce | undefined,
    ): void => {
      if (!targetForce && !otherSeg.p1Force && !otherSeg.p2Force) return

      let fx: number
      let fy: number
      // Adjacent segments share an endpoint. Geometry stays fixed until all
      // forces have been summed, and each segment belongs to one opposite line.
      if (
        otherSeg.lastTargetLine === targetLine &&
        otherSeg.lastEndpointIndex === epIdx
      ) {
        if (!otherSeg.lastForceActive) return
        fx = otherSeg.lastFx
        fy = otherSeg.lastFy
      } else {
        let closestX = otherSeg.p1.x
        let closestY = otherSeg.p1.y
        if (otherSeg.lengthSquared !== 0) {
          const projectionRatio = Math.max(
            0,
            Math.min(
              1,
              ((ep.x - otherSeg.p1.x) * otherSeg.deltaX +
                (ep.y - otherSeg.p1.y) * otherSeg.deltaY) /
                otherSeg.lengthSquared,
            ),
          )
          closestX += projectionRatio * otherSeg.deltaX
          closestY += projectionRatio * otherSeg.deltaY
        }
        const dx = ep.x - closestX
        const dy = ep.y - closestY
        const dSq = dx * dx + dy * dy
        otherSeg.lastTargetLine = targetLine
        otherSeg.lastEndpointIndex = epIdx
        if (dSq <= EPSILON) {
          otherSeg.lastForceActive = false
          return
        }
        const dist = Math.sqrt(dSq)
        const mag =
          SEGMENT_FORCE_MULTIPLIER *
          FORCE_MAGNITUDE *
          Math.exp(-FORCE_DECAY_RATE * dist)
        fx = (dx / dist) * mag
        fy = (dy / dist) * mag
        otherSeg.lastFx = fx
        otherSeg.lastFy = fy
        otherSeg.lastForceActive = true
      }

      // push this endpoint
      if (targetForce) {
        targetForce.fx += fx
        targetForce.fy += fy
      }
      // equal & opposite distributed onto the two endpoints of the other seg
      if (otherSeg.p1Force) {
        otherSeg.p1Force.fx += -fx / 2
        otherSeg.p1Force.fy += -fy / 2
      }
      if (otherSeg.p2Force) {
        otherSeg.p2Force.fx += -fx / 2
        otherSeg.p2Force.fy += -fy / 2
      }
    }

    // Points move only after all forces have been accumulated.
    for (let i = 0; i < numPolyLines; i++) {
      for (let j = i + 1; j < numPolyLines; j++) {
        const { segments: segments1, vias: vias1 } = geometry[i]!
        const { segments: segments2, vias: vias2 } = geometry[j]!

        // --- Interaction Calculations ---

        // a) Segment <-> Segment
        for (const seg1 of segments1) {
          for (const seg2 of segments2) {
            if (seg1.layer === seg2.layer) {
              // endpoints of s1 against s2
              endpointForce(seg1.p1, seg1.p1Idx, seg2, i, seg1.p1Force)
              endpointForce(seg1.p2, seg1.p2Idx, seg2, i, seg1.p2Force)
              // endpoints of s2 against s1
              endpointForce(seg2.p1, seg2.p1Idx, seg1, j, seg2.p1Force)
              endpointForce(seg2.p2, seg2.p2Idx, seg1, j, seg2.p2Force)
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
                if (via1.force) {
                  via1.force.fx += fx_j_on_i
                  via1.force.fy += fy_j_on_i
                }

                // Force from via1 (i) onto seg2 (j) - Apply opposite force to segment endpoints
                if (seg2.p1Force) {
                  seg2.p1Force.fx += -fx_j_on_i / 2
                  seg2.p1Force.fy += -fy_j_on_i / 2
                }
                if (seg2.p2Force) {
                  seg2.p2Force.fx += -fx_j_on_i / 2
                  seg2.p2Force.fy += -fy_j_on_i / 2
                }
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
                if (via2.force) {
                  via2.force.fx += fx_i_on_j
                  via2.force.fy += fy_i_on_j
                }

                // Force from via2 (j) onto seg1 (i) - Apply opposite force to segment endpoints
                if (seg1.p1Force) {
                  seg1.p1Force.fx += -fx_i_on_j / 2
                  seg1.p1Force.fy += -fy_i_on_j / 2
                }
                if (seg1.p2Force) {
                  seg1.p2Force.fx += -fx_i_on_j / 2
                  seg1.p2Force.fy += -fy_i_on_j / 2
                }
              }
            }
          }
        }

        // c) Via <-> Via
        for (const via1 of vias1) {
          for (const via2 of vias2) {
            if (via1.layers.some((z) => via2.layers.includes(z))) {
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
                if (via1.force) {
                  via1.force.fx += fx_j_on_i
                  via1.force.fy += fy_j_on_i
                }
                // Apply force from via1 (i) onto via2 (j)
                if (via2.force) {
                  via2.force.fx += -fx_j_on_i
                  via2.force.fy += -fy_j_on_i
                }
              }
            }
          }
        }
      }
    }

    // 2.5 Calculate forces between vias WITHIN the SAME polyline
    for (let i = 0; i < numPolyLines; i++) {
      const { vias } = geometry[i]!

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
            if (via1.force) {
              via1.force.fx += fx_2_on_1
              via1.force.fy += fy_2_on_1
            }
            // Apply force from via1 onto via2 (both on line i) - opposite direction
            if (via2.force) {
              via2.force.fx += -fx_2_on_1
              via2.force.fy += -fy_2_on_1
            }
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
