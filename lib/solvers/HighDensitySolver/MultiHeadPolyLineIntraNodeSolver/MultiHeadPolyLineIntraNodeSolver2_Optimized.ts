import { PolyLine2, MHPoint2, Candidate2 } from "./types2"
import { MultiHeadPolyLineIntraNodeSolver } from "./MultiHeadPolyLineIntraNodeSolver"

type PointToSegmentVector = { dx: number; dy: number }
type ForceAccumulator = { fx: number; fy: number }

function setPointToSegmentVector(
  point: MHPoint2,
  segmentStart: MHPoint2,
  segmentEnd: MHPoint2,
  vector: PointToSegmentVector,
): void {
  const segmentDx = segmentEnd.x - segmentStart.x
  const segmentDy = segmentEnd.y - segmentStart.y
  const segmentLengthSq = segmentDx * segmentDx + segmentDy * segmentDy
  if (segmentLengthSq === 0) {
    vector.dx = point.x - segmentStart.x
    vector.dy = point.y - segmentStart.y
    return
  }
  let projection =
    ((point.x - segmentStart.x) * segmentDx +
      (point.y - segmentStart.y) * segmentDy) /
    segmentLengthSq
  projection = Math.max(0, Math.min(1, projection))
  vector.dx = point.x - (segmentStart.x + projection * segmentDx)
  vector.dy = point.y - (segmentStart.y + projection * segmentDy)
}

type ForceSegment = {
  p1: MHPoint2
  p2: MHPoint2
  layer: number
  p1Force: ForceAccumulator | null
  p2Force: ForceAccumulator | null
}

type ForceVia = {
  point: MHPoint2
  layers: number[]
  force: ForceAccumulator | null
}

type ForceGeometry = {
  segments: ForceSegment[]
  vias: ForceVia[]
  internalViaPairs: Array<[ForceVia, ForceVia]>
}

type EndpointSegmentInteraction = {
  point: MHPoint2
  force: ForceAccumulator | null
  segment: ForceSegment
}

type ForceInteractions = {
  endpointSegmentInteractions: EndpointSegmentInteraction[]
  firstViaSegmentPairs: Array<[ForceVia, ForceSegment]>
  secondViaSegmentPairs: Array<[ForceVia, ForceSegment]>
  viaPairs: Array<[ForceVia, ForceVia]>
}

type ForceWorkspace = {
  geometry: ForceGeometry[]
  interactions: ForceInteractions[]
  netForces: ForceAccumulator[][]
}

function createForceWorkspace(polyLines: PolyLine2[]): ForceWorkspace {
  const netForces = polyLines.map((polyLine) =>
    polyLine.mPoints.map(() => ({ fx: 0, fy: 0 })),
  )
  const geometry = polyLines.map((polyLine, lineIndex): ForceGeometry => {
    const points = [polyLine.start, ...polyLine.mPoints, polyLine.end]
    const pointForces: Array<ForceAccumulator | null> = [
      null,
      ...netForces[lineIndex]!,
      null,
    ]
    const segments = points.slice(0, -1).map(
      (point, index): ForceSegment => ({
        p1: point,
        p2: points[index + 1]!,
        layer: point.z2,
        p1Force: pointForces[index]!,
        p2Force: pointForces[index + 1]!,
      }),
    )
    const vias = points.flatMap((point, index): ForceVia[] =>
      point.z1 === point.z2
        ? []
        : [{ point, layers: [point.z1, point.z2], force: pointForces[index]! }],
    )
    const internalViaPairs: Array<[ForceVia, ForceVia]> = []
    for (let firstIndex = 0; firstIndex < vias.length; firstIndex++) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < vias.length;
        secondIndex++
      ) {
        internalViaPairs.push([vias[firstIndex]!, vias[secondIndex]!])
      }
    }
    return { segments, vias, internalViaPairs }
  })
  const interactions: ForceInteractions[] = []
  for (
    let firstLineIndex = 0;
    firstLineIndex < geometry.length;
    firstLineIndex++
  ) {
    for (
      let secondLineIndex = firstLineIndex + 1;
      secondLineIndex < geometry.length;
      secondLineIndex++
    ) {
      const firstGeometry = geometry[firstLineIndex]!
      const secondGeometry = geometry[secondLineIndex]!
      const endpointSegmentInteractions: EndpointSegmentInteraction[] = []
      const firstViaSegmentPairs: Array<[ForceVia, ForceSegment]> = []
      const secondViaSegmentPairs: Array<[ForceVia, ForceSegment]> = []
      const viaPairs: Array<[ForceVia, ForceVia]> = []
      for (const firstSegment of firstGeometry.segments) {
        for (const secondSegment of secondGeometry.segments) {
          if (firstSegment.layer === secondSegment.layer) {
            endpointSegmentInteractions.push(
              {
                point: firstSegment.p1,
                force: firstSegment.p1Force,
                segment: secondSegment,
              },
              {
                point: firstSegment.p2,
                force: firstSegment.p2Force,
                segment: secondSegment,
              },
              {
                point: secondSegment.p1,
                force: secondSegment.p1Force,
                segment: firstSegment,
              },
              {
                point: secondSegment.p2,
                force: secondSegment.p2Force,
                segment: firstSegment,
              },
            )
          }
        }
      }
      for (const firstVia of firstGeometry.vias) {
        for (const secondSegment of secondGeometry.segments) {
          if (firstVia.layers.includes(secondSegment.layer)) {
            firstViaSegmentPairs.push([firstVia, secondSegment])
          }
        }
      }
      for (const secondVia of secondGeometry.vias) {
        for (const firstSegment of firstGeometry.segments) {
          if (secondVia.layers.includes(firstSegment.layer)) {
            secondViaSegmentPairs.push([secondVia, firstSegment])
          }
        }
      }
      for (const firstVia of firstGeometry.vias) {
        for (const secondVia of secondGeometry.vias) {
          if (
            firstVia.layers.some((layer) => secondVia.layers.includes(layer))
          ) {
            viaPairs.push([firstVia, secondVia])
          }
        }
      }
      interactions.push({
        endpointSegmentInteractions,
        firstViaSegmentPairs,
        secondViaSegmentPairs,
        viaPairs,
      })
    }
  }
  return { geometry, interactions, netForces }
}

export class MultiHeadPolyLineIntraNodeSolver2 extends MultiHeadPolyLineIntraNodeSolver {
  // Geometry retains live point references while its topology stays fixed.
  private readonly forceWorkspaceByPolyLines = new WeakMap<
    PolyLine2[],
    ForceWorkspace
  >()

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
    const pointToSegmentVector = { dx: 0, dy: 0 }

    // 1. Initialize the candidate's reusable force workspace.
    let workspace = this.forceWorkspaceByPolyLines.get(polyLines)
    if (!workspace) {
      workspace = createForceWorkspace(polyLines)
      this.forceWorkspaceByPolyLines.set(polyLines, workspace)
    } else {
      for (const lineForces of workspace.netForces) {
        for (const force of lineForces) {
          force.fx = 0
          force.fy = 0
        }
      }
    }
    const { geometry, netForces } = workspace

    // 2. Calculate forces between all pairs of polylines

    for (const interaction of workspace.interactions) {
      // --- Interaction Calculations ---

      // a) Segment <-> Segment
      for (const {
        point,
        force,
        segment,
      } of interaction.endpointSegmentInteractions) {
        setPointToSegmentVector(
          point,
          segment.p1,
          segment.p2,
          pointToSegmentVector,
        )
        const { dx, dy } = pointToSegmentVector
        const distanceSquared = dx * dx + dy * dy
        if (distanceSquared <= EPSILON) continue
        const distance = Math.sqrt(distanceSquared)
        const magnitude =
          SEGMENT_FORCE_MULTIPLIER *
          FORCE_MAGNITUDE *
          Math.exp(-FORCE_DECAY_RATE * distance)
        const forceX = (dx / distance) * magnitude
        const forceY = (dy / distance) * magnitude

        if (force) {
          force.fx += forceX
          force.fy += forceY
        }
        if (segment.p1Force) {
          segment.p1Force.fx += -forceX / 2
          segment.p1Force.fy += -forceY / 2
        }
        if (segment.p2Force) {
          segment.p2Force.fx += -forceX / 2
          segment.p2Force.fy += -forceY / 2
        }
      }

      // b) Via <-> Segment
      for (const [via1, seg2] of interaction.firstViaSegmentPairs) {
        setPointToSegmentVector(
          via1.point,
          seg2.p1,
          seg2.p2,
          pointToSegmentVector,
        )
        const { dx, dy } = pointToSegmentVector
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
      for (const [via2, seg1] of interaction.secondViaSegmentPairs) {
        setPointToSegmentVector(
          via2.point,
          seg1.p1,
          seg1.p2,
          pointToSegmentVector,
        )
        const { dx, dy } = pointToSegmentVector
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

      // c) Via <-> Via
      for (const [via1, via2] of interaction.viaPairs) {
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

    // 2.5 Calculate forces between vias WITHIN the SAME polyline
    for (let i = 0; i < numPolyLines; i++) {
      for (const [via1, via2] of geometry[i]!.internalViaPairs) {
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
