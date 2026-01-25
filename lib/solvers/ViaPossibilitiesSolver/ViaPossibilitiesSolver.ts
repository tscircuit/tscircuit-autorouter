import { NodeWithPortPoints } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { GraphicsObject } from "graphics-debug"
import {
  Face,
  getCentroidsFromInnerBoxIntersections,
} from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/getCentroidsFromInnerBoxIntersections"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import {
  Bounds,
  Point,
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import { getPortPairMap, PortPairMap } from "lib/utils/getPortPairs"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { safeTransparentize } from "../colors"
import { distance } from "@tscircuit/math-utils"

export type CandidateHash = string
export type ConnectionName = string
export type FaceId = string

export interface Candidate {
  viaLocationAssignments: Map<FaceId, ConnectionName>
  // Each iteration, we move the current heads closer to the end face
  currentHeads: Map<ConnectionName, { faceId: FaceId; z: number }>
  headPaths: Map<ConnectionName, { faceId: FaceId; z: number }[]> // Added: Track the path of each head
  incompleteHeads: ConnectionName[]
  depth: number
  possible: boolean
  h?: number
  g?: number
  f?: number
}

export const hashCandidate = (candidate: Candidate): CandidateHash => {
  const viaAssignmentsString = Array.from(
    candidate.viaLocationAssignments.entries(),
  )
    .sort()
    .map(([faceId, connName]) => `${faceId}:${connName}`)
    .join("|")
  const currentHeadsString = Array.from(candidate.currentHeads.entries())
    .sort()
    .map(([connName, { faceId, z }]) => `${connName}:${faceId}@${z}`)
    .join("|")
  return `${viaAssignmentsString}$${currentHeadsString}`
}
export const hashViaLocation = (p: Point) => {
  return `${p.x},${p.y}`
}

export interface FaceWithSegments extends Face {
  segments: Array<{ start: Point; end: Point }>
  requiresViaFromOneOfConnections?: ConnectionName[]
}

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface Segment {
  start: Point3
  end: Point3
  connectionName: string
}

export interface FaceEdge {
  crossesOverConnectionName: ConnectionName
  possibleZOfConnection: number[]
  crossesToFaceId: FaceId
}

export class ViaPossibilitiesSolver extends BaseSolver {
  override getSolverName(): string {
    return "ViaPossibilitiesSolver"
  }

  candidates: Candidate[]
  faces: Map<FaceId, FaceWithSegments>
  faceEdges: Map<FaceId, FaceEdge[]> // Keep the type definition as is
  bounds: Bounds
  maxViaCount: number
  portPairMap: PortPairMap
  transitionConnectionNames: ConnectionName[]
  sameLayerConnectionNames: ConnectionName[]
  connectionEndpointFaceMap: Map<
    ConnectionName,
    { startFaceId: FaceId; endFaceId: string }
  >
  exploredCandidateHashes: Set<CandidateHash>
  lastCandidate: Candidate | null
  colorMap: Record<string, string>
  nodeWidth: number
  availableZ: number[]
  GREEDY_MULTIPLIER = 1
  viaDiameter: number

  constructor({
    nodeWithPortPoints,
    colorMap,
    viaDiameter,
  }: {
    nodeWithPortPoints: NodeWithPortPoints
    colorMap?: Record<string, string>
    viaDiameter?: number
  }) {
    super()
    this.MAX_ITERATIONS = 100e3
    this.colorMap =
      colorMap ?? generateColorMapFromNodeWithPortPoints(nodeWithPortPoints)
    this.maxViaCount = 5
    this.exploredCandidateHashes = new Set()
    this.bounds = getBoundsFromNodeWithPortPoints(nodeWithPortPoints)
    this.nodeWidth = this.bounds.maxX - this.bounds.minX
    this.portPairMap = getPortPairMap(nodeWithPortPoints)
    this.stats.solutionsFound = 0
    this.availableZ = nodeWithPortPoints.availableZ ?? [0, 1]
    this.viaDiameter = viaDiameter ?? 0.6

    this.transitionConnectionNames = Array.from(
      this.portPairMap
        .entries()
        .filter(([connectionName, { start, end }]) => start.z !== end.z)
        .map(([connectionName]) => connectionName),
    )
    this.sameLayerConnectionNames = Array.from(
      this.portPairMap
        .entries()
        .filter(([connectionName, { start, end }]) => start.z === end.z)
        .map(([connectionName]) => connectionName),
    )

    const segments: Segment[] = Array.from(this.portPairMap.values())

    const { faces } = getCentroidsFromInnerBoxIntersections(
      this.bounds,
      segments,
    )
    this.faces = new Map()
    for (let i = 0; i < faces.length; i++) {
      const { vertices } = faces[i]
      const segments: Array<{ start: Point; end: Point }> = []
      for (let u = 0; u < vertices.length; u++) {
        segments.push({
          start: vertices[u],
          end: vertices[(u + 1) % vertices.length],
        })
      }

      // A face will require a connection from one of the connections when it contains
      // vertices that show the trace is on the same layer
      let requiresViaFromOneOfConnections: ConnectionName[] | undefined =
        undefined
      const connectionNamesInFace = new Set<string>()
      for (const vertex of vertices) {
        for (const connectionName of vertex.connectionNames ?? []) {
          connectionNamesInFace.add(connectionName)
        }
      }
      // -------------------------- REVISE THIS ---------------------------------------
      const sameLayerConnectionNames = this.sameLayerConnectionNames
        .filter((cn) => connectionNamesInFace.has(cn))
        .map((connName) => ({
          connName,
          z: this.portPairMap.get(connName)!.start.z,
        }))

      const allSameZ = sameLayerConnectionNames.every(
        ({ z }) => z === sameLayerConnectionNames[0].z,
      )

      if (sameLayerConnectionNames.length > 1 && allSameZ) {
        requiresViaFromOneOfConnections = sameLayerConnectionNames.map(
          (c) => c.connName,
        )
      }
      // -------------------------- REVISE THIS ---------------------------------------

      this.faces.set(`face${i.toString()}`, {
        ...faces[i],
        segments,
        requiresViaFromOneOfConnections,
      })
    }

    this.connectionEndpointFaceMap = new Map()
    for (const [connectionName, { start, end }] of this.portPairMap) {
      // Determine which face is the contains the start or end
      let startFaceId: string | null = null
      let endFaceId: string | null = null
      for (const [faceId, { segments }] of this.faces.entries()) {
        for (const seg of segments) {
          if (
            !startFaceId &&
            pointToSegmentDistance(start, seg.start, seg.end) < 0.001
          ) {
            startFaceId = faceId
            break
          }
          if (
            !endFaceId &&
            pointToSegmentDistance(end, seg.start, seg.end) < 0.001
          ) {
            endFaceId = faceId
            break
          }
        }
        if (startFaceId && endFaceId) break
      }

      if (!startFaceId || !endFaceId) {
        throw new Error(`Could not find face for connection ${connectionName}`)
      }

      this.connectionEndpointFaceMap.set(connectionName, {
        startFaceId,
        endFaceId,
      })
    }

    // Compute face edges. Find shared segments between faces and determine which connection crosses that edge.
    this.faceEdges = new Map()
    const faceIds = Array.from(this.faces.keys())

    for (let i = 0; i < faceIds.length; i++) {
      const faceId1 = faceIds[i]
      if (!this.faceEdges.has(faceId1)) this.faceEdges.set(faceId1, [])
      const face1 = this.faces.get(faceId1)!

      for (let j = i + 1; j < faceIds.length; j++) {
        const faceId2 = faceIds[j]
        if (!this.faceEdges.has(faceId2)) this.faceEdges.set(faceId2, [])
        const face2 = this.faces.get(faceId2)!

        for (const seg1 of face1.segments) {
          for (const seg2 of face2.segments) {
            // Check if segments are essentially the same (endpoints match, possibly reversed)
            const startsMatch = distance(seg1.start, seg2.start) < 0.001
            const endsMatch = distance(seg1.end, seg2.end) < 0.001
            const startEndMatch = distance(seg1.start, seg2.end) < 0.001
            const endStartMatch = distance(seg1.end, seg2.start) < 0.001

            if (
              (startsMatch && endsMatch) ||
              (startEndMatch && endStartMatch)
            ) {
              // Found a shared segment. Now find the connection name associated with its vertices.
              // We assume a shared segment's vertices will have the crossing connection name.
              // It's possible vertices have multiple names; we need the one NOT belonging to the faces'
              // sameLayerConnectionNames if applicable, or simply one present on the vertex.
              // For simplicity, we'll just grab the first connection name found on the start vertex.
              // A more robust approach might be needed if vertices can belong to multiple crossing segments.

              const vertex1 = face1.vertices.find(
                (v) => distance(v, seg1.start) < 0.001,
              )
              const connectionNames = vertex1?.connectionNames
              if (connectionNames && connectionNames.size > 0) {
                // Heuristic: Pick the first connection name found. This might need refinement.
                const crossesOverConnectionName = connectionNames
                  .values()
                  .next().value!

                const portPair = this.portPairMap.get(
                  crossesOverConnectionName!,
                )
                if (!portPair) {
                  console.warn(
                    `Could not find port pair for connection: ${crossesOverConnectionName} while creating face edge between ${faceId1} and ${faceId2}`,
                  )
                  continue // Skip if connection details aren't found
                }

                const possibleZOfConnection =
                  portPair.start.z === portPair.end.z
                    ? [portPair.start.z]
                    : this.availableZ // If it transitions, any Z is possible? Or just start/end? Using availableZ for now.
                // TODO: Refine possibleZOfConnection logic if needed. Maybe it should just be [start.z, end.z]?

                // Add edge from face1 to face2
                if (
                  !this.faceEdges
                    .get(faceId1)!
                    .some((edge) => edge.crossesToFaceId === faceId2)
                ) {
                  this.faceEdges.get(faceId1)!.push({
                    crossesToFaceId: faceId2,
                    crossesOverConnectionName,
                    possibleZOfConnection,
                  })
                }

                // Add edge from face2 to face1
                if (
                  !this.faceEdges
                    .get(faceId2)!
                    .some((edge) => edge.crossesToFaceId === faceId1)
                ) {
                  this.faceEdges.get(faceId2)!.push({
                    crossesToFaceId: faceId1,
                    crossesOverConnectionName,
                    possibleZOfConnection,
                  })
                }
                // Break inner loops once shared segment is processed for this pair
                // Continue to check other segments in case faces share multiple boundaries
              } else {
                console.warn(
                  `Shared segment between ${faceId1} and ${faceId2} found, but no connection name associated with vertex ${JSON.stringify(seg1.start)}`,
                )
              }
              // Don't break here, faces might share more than one segment boundary
            }
          }
        }
      }
    }

    // Initialize currentHeads with faceId and starting z-layer
    const initialHeads: Map<ConnectionName, { faceId: FaceId; z: number }> =
      new Map()
    for (const [
      connectionName,
      { startFaceId },
    ] of this.connectionEndpointFaceMap.entries()) {
      const startZ = this.portPairMap.get(connectionName)!.start.z
      initialHeads.set(connectionName, { faceId: startFaceId, z: startZ })
    }

    // Initialize head paths with the starting faceId and z-layer
    const initialHeadPaths: Map<
      ConnectionName,
      { faceId: FaceId; z: number }[]
    > = new Map()
    for (const [connectionName, { faceId, z }] of initialHeads.entries()) {
      initialHeadPaths.set(connectionName, [{ faceId, z }]) // Start path with the initial face and layer
    }

    this.candidates = [
      {
        viaLocationAssignments: new Map(),
        currentHeads: initialHeads,
        headPaths: initialHeadPaths, // Initialize head paths
        incompleteHeads: Array.from(initialHeads.keys()),
        depth: 0,
        possible: false,
      },
    ]
    this.exploredCandidateHashes.add(hashCandidate(this.candidates[0]))
    this.lastCandidate = this.candidates[0]
  }

  _step() {
    const currentCandidate = this.candidates.shift()
    if (!currentCandidate) {
      this.solved = true
      return
    }
    this.lastCandidate = currentCandidate

    if (currentCandidate.incompleteHeads.length === 0) {
      if (this.isCandidatePossible(currentCandidate)) {
        currentCandidate.possible = true
        this.stats.solutionsFound += 1
      }
    }

    this.candidates.push(...this.getUnexploredNeighbors(currentCandidate))
    this.candidates.sort((a, b) => a.f! - b.f!)
  }

  isCandidatePossible(candidate: Candidate): boolean {
    if (candidate.incompleteHeads.length > 0) return false

    // Check 1: Total number of vias does not exceed the limit
    if (candidate.viaLocationAssignments.size > this.maxViaCount) {
      return false
    }

    // Count vias per connection
    const viasPerConnection = new Map<ConnectionName, number>()
    for (const connectionName of candidate.viaLocationAssignments.values()) {
      viasPerConnection.set(
        connectionName,
        (viasPerConnection.get(connectionName) ?? 0) + 1,
      )
    }

    // Check 2: Transition connection names must have an odd number of vias
    for (const connectionName of this.transitionConnectionNames) {
      const viaCount = viasPerConnection.get(connectionName) ?? 0
      if (viaCount % 2 === 0) {
        // Must have at least one via, and an odd number
        return false
      }
    }

    // Check 3: Same layer connection names must have an even number of vias (or 0)
    for (const connectionName of this.sameLayerConnectionNames) {
      const viaCount = viasPerConnection.get(connectionName) ?? 0
      if (viaCount % 2 !== 0) {
        return false
      }
    }

    // All checks passed
    return true
  }

  computeG(candidate: Candidate, parent: Candidate) {
    const DEPTH_PENALTY_DIST = this.nodeWidth * 0.2
    return candidate.depth * DEPTH_PENALTY_DIST
  }

  computeH(candidate: Candidate) {
    // Sum of the distance remaining for each head
    let distanceSum = 0
    for (const connectionName of candidate.incompleteHeads) {
      const { faceId } = candidate.currentHeads.get(connectionName)!
      const centroid = this.faces.get(faceId)!.centroid
      const end = this.portPairMap.get(connectionName)!.end
      distanceSum += distance(centroid, end) // Heuristic based on 2D distance to target centroid
    }

    const VIA_PENALTY_DIST = this.nodeWidth * 0.2
    distanceSum += candidate.viaLocationAssignments.size * VIA_PENALTY_DIST

    return distanceSum
  }

  getUnexploredNeighbors(candidate: Candidate): Candidate[] {
    const newCandidates: Candidate[] = []
    for (const currentHeadConnName of candidate.incompleteHeads) {
      // Move the incomplete head forward in every possible direction, also consider the placement of any vias
      const currentHead = candidate.currentHeads.get(currentHeadConnName)!
      const { start: startPort, end: endPort } =
        this.portPairMap.get(currentHeadConnName)!
      const finalFaceIdForHead =
        this.connectionEndpointFaceMap.get(currentHeadConnName)!.endFaceId
      const neighborFaceEdges = this.faceEdges.get(currentHead.faceId)! // Now using FaceEdge[]
      const currentFace = this.faces.get(currentHead.faceId)!
      const currentPath = candidate.headPaths.get(currentHeadConnName)!

      // Iterate through possible moves to neighboring faces
      for (const neighborEdge of neighborFaceEdges) {
        const neighborFaceId = neighborEdge.crossesToFaceId
        const crossesOverConnectionName = neighborEdge.crossesOverConnectionName
        const possibleZOfConnection = neighborEdge.possibleZOfConnection
        const isFinalFace = finalFaceIdForHead === neighborFaceId
        const onWrongLayerForFinalFace =
          isFinalFace && currentHead.z !== endPort.z

        // HACK: this is a lazy check, after a connection has a via you don't really need to
        // "jump it", so we remove the requirement to have a via to jump it. In the future we
        // may want to track the this differently, essentially the possibleZOfConnection is
        // unknown as soon as a connection has a via
        const crossingConnectionMayHaveChanged =
          candidate.viaLocationAssignments
            .values()
            .some((connName) => connName === crossesOverConnectionName)

        // Check for conflict: Are we trying to cross a connection on the same Z layer?
        const mustCreateViaToGoToFace =
          onWrongLayerForFinalFace ||
          (crossesOverConnectionName &&
            !crossingConnectionMayHaveChanged &&
            crossesOverConnectionName !== currentHeadConnName &&
            possibleZOfConnection.includes(currentHead.z))

        // console.log({
        //   currentHeadConnName,
        //   onWrongLayerForFinalFace,
        //   crossesOverConnectionName,
        //   isInIncompleteHeads: candidate.incompleteHeads.includes(
        //     crossesOverConnectionName,
        //   ),
        //   neighborFaceId,
        //   mustCreateViaToGoToFace,
        //   incompleteHeads: candidate.incompleteHeads,
        // })

        if (mustCreateViaToGoToFace) {
          // CONFLICT: Must place a via in the *current* face before crossing, if possible.

          const faceHasNoVia = !candidate.viaLocationAssignments.has(
            currentHead.faceId,
          )
          const viaCountOk =
            candidate.viaLocationAssignments.size < this.maxViaCount

          const canPlaceVia = faceHasNoVia && viaCountOk

          if (canPlaceVia) {
            // Generate a "place via" candidate (stays in current face, changes Z)
            const newViaLocationAssignments = new Map(
              candidate.viaLocationAssignments,
            )
            newViaLocationAssignments.set(
              currentHead.faceId,
              currentHeadConnName,
            )

            const newZ =
              this.availableZ[
                (this.availableZ.indexOf(currentHead.z) + 1) %
                  this.availableZ.length
              ]
            // Prevent cycles: Check if this exact {faceId, z} state was already visited
            if (
              !currentPath.some(
                (p) => p.faceId === currentHead.faceId && p.z === newZ,
              )
            ) {
              const newCurrentHeads = new Map(candidate.currentHeads)
              newCurrentHeads.set(currentHeadConnName, {
                faceId: currentHead.faceId, // Stays in the same face
                z: newZ, // Changes Z layer
              })

              const newHeadPaths = new Map(candidate.headPaths)
              newHeadPaths.set(currentHeadConnName, [
                ...currentPath,
                { faceId: currentHead.faceId, z: newZ }, // Add via transition step
              ])

              let newIncompleteHeads = candidate.incompleteHeads
              // Check if this head reached its destination
              if (neighborFaceId === finalFaceIdForHead) {
                const endZ = this.portPairMap.get(currentHeadConnName)!.end.z
                if (newZ === endZ) {
                  // Head is complete only if it reaches the final face AND the correct Z layer
                  newIncompleteHeads = candidate.incompleteHeads.filter(
                    (h) => h !== currentHeadConnName,
                  )
                }
              }

              const viaCandidate: Candidate = {
                ...candidate,
                incompleteHeads: newIncompleteHeads,
                viaLocationAssignments: newViaLocationAssignments,
                currentHeads: newCurrentHeads,
                headPaths: newHeadPaths,
                depth: candidate.depth + 1,
                // incompleteHeads remains the same for this step
              }
              viaCandidate.h = this.computeH(viaCandidate)
              viaCandidate.g = this.computeG(viaCandidate, candidate)
              viaCandidate.f =
                viaCandidate.g + viaCandidate.h * this.GREEDY_MULTIPLIER
              newCandidates.push(viaCandidate)
            }
          }
          // If via cannot be placed, this path is blocked for this neighbor edge.
          // Continue to the next neighborEdge.
        } else {
          // NO CONFLICT: Generate a "move head" candidate (moves to neighbor face, same Z)

          // Prevent cycles: Check if moving to {neighborFaceId, currentHead.z} was already visited
          if (
            currentPath.some(
              (p) => p.faceId === neighborFaceId && p.z === currentHead.z,
            )
          ) {
            continue // Skip if this state was already visited in the current path
          }

          const newCurrentHeads = new Map(candidate.currentHeads)
          newCurrentHeads.set(currentHeadConnName, {
            faceId: neighborFaceId,
            z: currentHead.z,
          })

          const newHeadPaths = new Map(candidate.headPaths)
          newHeadPaths.set(currentHeadConnName, [
            ...currentPath,
            { faceId: neighborFaceId, z: currentHead.z }, // Add move step
          ])

          let newIncompleteHeads = candidate.incompleteHeads
          // Check if this head reached its destination
          if (neighborFaceId === finalFaceIdForHead) {
            const endZ = this.portPairMap.get(currentHeadConnName)!.end.z
            if (currentHead.z === endZ) {
              // Head is complete only if it reaches the final face AND the correct Z layer
              newIncompleteHeads = candidate.incompleteHeads.filter(
                (h) => h !== currentHeadConnName,
              )
            }
          }

          const moveCandidate: Candidate = {
            ...candidate,
            currentHeads: newCurrentHeads,
            headPaths: newHeadPaths,
            depth: candidate.depth + 1,
            incompleteHeads: newIncompleteHeads,
            // viaLocationAssignments remains the same
          }

          moveCandidate.h = this.computeH(moveCandidate)
          moveCandidate.g = this.computeG(moveCandidate, candidate)
          moveCandidate.f =
            moveCandidate.g + moveCandidate.h * this.GREEDY_MULTIPLIER
          newCandidates.push(moveCandidate)
        }
      }
    }

    // Filter out explored candidates before returning
    const unexploredNewCandidates: Candidate[] = []
    for (const newCandidate of newCandidates) {
      const candidateHash = hashCandidate(newCandidate)
      if (this.exploredCandidateHashes.has(candidateHash)) continue
      this.exploredCandidateHashes.add(candidateHash)
      unexploredNewCandidates.push(newCandidate)
    }
    return unexploredNewCandidates
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      points: [],
      lines: [],
      circles: [],
      rects: [],
      title: "Via Possibilities Solver State",
      coordinateSystem: "cartesian",
    }

    // Generate a simple color map
    const colorMap = this.colorMap

    // 1. Draw Node Bounds
    const boundaryColor = this.lastCandidate?.possible ? "green" : "gray"
    graphics.lines!.push({
      points: [
        { x: this.bounds.minX, y: this.bounds.minY },
        { x: this.bounds.maxX, y: this.bounds.minY },
        { x: this.bounds.maxX, y: this.bounds.maxY },
        { x: this.bounds.minX, y: this.bounds.maxY },
        { x: this.bounds.minX, y: this.bounds.minY },
      ],
      strokeColor: boundaryColor,
      strokeWidth: 0.05,
    })

    // 2. Draw Faces and Centroids
    for (const [faceId, face] of this.faces.entries()) {
      graphics.points!.push({
        x: face.centroid.x,
        y: face.centroid.y,
        color: "black",
        label: face.requiresViaFromOneOfConnections
          ? `${faceId}\nRequires Via: ${face.requiresViaFromOneOfConnections.join(", ")}`
          : faceId,
      })
      // Removed text push, label is now part of the point
    }

    // 3. Draw Port Pairs (Original Segments)
    for (const [connectionName, { start, end }] of this.portPairMap.entries()) {
      const color = colorMap[connectionName] ?? "black"
      graphics.lines!.push({
        points: [start, end],
        strokeColor: color,
        strokeDash: start.z !== end.z ? "5,5" : undefined,
        label: `${connectionName} (z${start.z}->z${end.z})`,
      })
      graphics.points!.push({
        x: start.x,
        y: start.y,
        color: color,
        label: `${connectionName} Start (z${start.z})`,
      })
      graphics.points!.push({
        x: end.x,
        y: end.y,
        color: color,
        label: `${connectionName} End (z${end.z})`,
      })
    }

    // 4. Visualize Last Candidate State
    if (this.lastCandidate) {
      // Draw Head Paths
      for (const [
        connectionName,
        pathEntries, // Array of { faceId: FaceId; z: number }
      ] of this.lastCandidate.headPaths.entries()) {
        const color = colorMap[connectionName] ?? "black"
        const portPair = this.portPairMap.get(connectionName)!

        let previousPoint: Point = portPair.start
        let previousZ = portPair.start.z

        for (const entry of pathEntries) {
          const face = this.faces.get(entry.faceId)
          if (!face) continue // Should not happen, but safety check

          const currentCentroid = face.centroid
          const currentZ = entry.z // Z layer *after* this step

          graphics.lines!.push({
            points: [previousPoint, currentCentroid],
            strokeColor: safeTransparentize(color, 0.9),
            strokeWidth: 0.08,
            // Dash if the segment *starts* on z=0
            strokeDash: previousZ === 1 ? [0.1, 0.1] : undefined,
            // label: `Path Seg: ${connectionName} z${previousZ}`, // Optional: for debugging
          })

          previousPoint = currentCentroid
          previousZ = currentZ // Update z for the *next* segment start
        }

        // If the head is complete, draw the final segment to the end point
        if (!this.lastCandidate.incompleteHeads.includes(connectionName)) {
          graphics.lines!.push({
            points: [previousPoint, portPair.end], // From last centroid to end
            strokeColor: safeTransparentize(color, 0.9),
            strokeWidth: 0.08,
            // Dash if the final segment *starts* on z=0
            strokeDash: previousZ === 1 ? [0.1, 0.1] : undefined,
            // label: `Path End: ${connectionName} z${previousZ}`, // Optional: for debugging
          })
        }
        // Add a single label for the whole path for clarity
        graphics.lines![graphics.lines!.length - 1].label =
          `Path: ${connectionName}`
      }

      // Draw current heads (optional, can be redundant with paths)
      for (const [
        connectionName,
        { faceId, z }, // Destructure faceId and z
      ] of this.lastCandidate.currentHeads.entries()) {
        const face = this.faces.get(faceId)
        if (face) {
          const color = colorMap[connectionName] ?? "black"
          // Add z-layer info to the label
          graphics.points!.push({
            x: face.centroid.x + 0.01,
            y: face.centroid.y + 0.01, // Slight offset for visibility
            color,
            label: `Head: ${connectionName} (z${z})`, // Include z-layer in label
          })
        }
      }

      // Draw assigned vias
      for (const [
        faceId,
        connectionName,
      ] of this.lastCandidate.viaLocationAssignments.entries()) {
        const face = this.faces.get(faceId)
        if (face) {
          const color = colorMap[connectionName] ?? "black"
          graphics.circles!.push({
            center: face.centroid,
            radius: this.viaDiameter / 2,
            fill: safeTransparentize(color, 0.5), // Make via fill 50% transparent
            stroke: "white",
            label: `Via: ${connectionName}`,
          })
        }
      }
    }
    return graphics
  }
}
