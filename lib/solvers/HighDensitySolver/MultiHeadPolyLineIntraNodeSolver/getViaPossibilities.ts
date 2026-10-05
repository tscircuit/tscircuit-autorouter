import { Bounds, getSegmentIntersection } from "@tscircuit/math-utils"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { getCentroidsFromInnerBoxIntersections } from "./getCentroidsFromInnerBoxIntersections"
import { getViaCombinations } from "./viaCombinationGenerator"

export interface Point3 {
  x: number
  y: number
  z: number
}

export type ConnectionName = string
export interface ViaPossibility {
  x: number
  y: number
  connectionNames: ConnectionName[]
}

export interface Segment {
  start: Point3
  end: Point3
  connectionName?: string
}

export interface ViaPlacement {
  x: number
  y: number
  connectionName: string
}

export type PortPair = { start: Point3; end: Point3; connectionName?: string }
export type PortPairMap = Map<ConnectionName, PortPair>

export const getViaPossibilitiesFromPortPairs = ({
  portPairs,
  availableZ,
  bounds,
  maxViaCount,
  minViaCount,
}: {
  portPairs: PortPairMap
  availableZ: number[]
  bounds: Bounds
  maxViaCount: number
  minViaCount: number
}): {
  viaPossibilities: ViaPossibility[]
  viaCombinations: Array<ViaPlacement[]>
} => {
  const zToSegments: Map<number, Array<Segment>> = new Map()
  const zToCentroidResult: Map<
    number,
    ReturnType<typeof getCentroidsFromInnerBoxIntersections>
  > = new Map()

  // STEP 1: Construct Segments
  for (const z of availableZ) {
    const zSegments: Array<Segment> = []
    for (const [connectionName, portPair] of portPairs.entries()) {
      const { start, end } = portPair
      if (start.z === z && end.z === z) {
        zSegments.push({ start, end, connectionName })
      } else if (start.z === z || end.z === z) {
        /* Same layer point */
        const slp = start.z === z ? start : end
        /* Opposite layer point */
        const olp = slp === start ? end : start

        const dx = olp.x - slp.x
        const dy = olp.y - slp.y

        // slp and ending at slt + delta * 3/4
        /* Segment End Point */
        const segEndPoint = { x: slp.x + (dx * 3) / 4, y: slp.y + (dy * 3) / 4 }

        // TODO add to zSegments
      }
    }
    zToSegments.set(z, zSegments)
  }

  // STEP 2: Find Centroids
  for (const z of availableZ) {
    zToCentroidResult.set(
      z,
      getCentroidsFromInnerBoxIntersections(bounds, zToSegments.get(z)! ?? []),
    )
  }

  // STEP 3: Map Centroids to Via Possibilities
  const viaPossibilities: Array<ViaPossibility> = []
  for (const z of availableZ) {
    const { faces } = zToCentroidResult.get(z)!
    for (const { centroid, vertices } of faces) {
      const connectionNamesInFace = new Set<string>()
      vertices.forEach((v) => {
        v.connectionNames?.forEach((connectionName) =>
          connectionNamesInFace.add(connectionName),
        )
      })

      viaPossibilities.push({
        x: centroid.x,
        y: centroid.y,
        connectionNames: Array.from(connectionNamesInFace),
      })
    }
  }

  // STEP 3.1: For each transition trace (different start/end z) add a via at the midpoint and before/after any
  // intersections from other connections
  for (const [connectionName, { start, end }] of portPairs.entries()) {
    const intersections: Array<{
      x: number
      y: number
      distFromStart: number
      connectionName: string
    }> = []

    for (const [
      intersectingConnectionName,
      otherTrace,
    ] of portPairs.entries()) {
      if (intersectingConnectionName === connectionName) continue
      // TODO check if otherTrace has any shared z
      // Determine if there's an intersection, if so where the intersection is
      const intersection: any = getSegmentIntersection(
        start,
        end,
        otherTrace.start,
        otherTrace.end,
      )
      if (!intersection) continue

      intersection.connectionName = intersectingConnectionName
      intersection.distFromStart = Math.sqrt(
        (intersection.x - start.x) ** 2 + (intersection.y - start.y) ** 2,
      )

      intersections.push(intersection)
    }

    intersections.sort((a, b) => a.distFromStart - b.distFromStart)

    // Add a via possibility between each intersection
    const keypoints = [start, ...intersections, end]
    console.log({ keypoints })
    for (let i = 0; i < keypoints.length - 1; i++) {
      const prev = keypoints[i]
      const next = keypoints[i + 1]
      const mid = {
        x: (prev.x + next.x) / 2,
        y: (prev.y + next.y) / 2,
        connectionNames: [connectionName],
      }
      viaPossibilities.push(mid)
    }
  }

  const candidatesByConn: Map<ConnectionName, Array<ViaPossibility>> = new Map()
  for (const via of viaPossibilities) {
    for (const connectionName of via.connectionNames) {
      if (!candidatesByConn.has(connectionName)) {
        candidatesByConn.set(connectionName, [])
      }
      candidatesByConn.get(connectionName)!.push(via)
    }
  }

  // STEP 4: Create all possible via combinations, taking into consideration min and max via count
  const viaCombinations = getViaCombinations(
    candidatesByConn,
    portPairs,
    maxViaCount,
    minViaCount,
  )

  return {
    viaPossibilities,
    viaCombinations,
  }
}
