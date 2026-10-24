import { distance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type Point = { x: number; y: number; z: number }
type Checker = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost
type Entry = { route: HighDensityIntraNodeRoute; sourceIterations: number; length: number; oddAngles: number }
type Start = { key: string; prefix: Point[] }
export type NativeWitnessResult = { route: HighDensityIntraNodeRoute | null; workUnits: number }

const MAX_ENTRIES = 64
const MAX_POINTS = 16_384
const MAX_REPLAY_POINTS = 4096
const MAX_ENTRIES_PER_KEY = 2

/** Own the exact scaled node consumed by every candidate in this portfolio. */
export const createNativeWitnessOwnedNode = (node: NodeWithPortPoints): NodeWithPortPoints => {
  const owned = structuredClone(node)
  Object.freeze(owned.center)
  for (const point of owned.portPoints) Object.freeze(point)
  Object.freeze(owned.portPoints)
  for (const pair of owned.portPointsInPairs ?? []) {
    for (const point of pair) Object.freeze(point)
    Object.freeze(pair)
  }
  if (owned.portPointsInPairs) Object.freeze(owned.portPointsInPairs)
  if (owned.availableZ) Object.freeze(owned.availableZ)
  return Object.freeze(owned)
}

/**
 * Shares original native microstep witnesses within one owned portfolio scene.
 * This certifies current native LOCAL feasibility, not physical board legality
 * or equality of the native objective/search policy. Fixed pads and board edges
 * are deliberately left to the same downstream stages as ordinary Single output.
 */
export class NativeRouteWitnessBroker {
  readonly diagnostics = {
    ownedNodeCount: 1, ownedPortPoints: 0, sceneSerializedBytes: 0,
    checkerStarts: 0, constructorSolvedSkipped: 0, keyBytes: 0, keyBuilds: 0,
    lookups: 0, misses: 0, replayAttempts: 0, hits: 0,
    nativeReplayCalls: 0, replayPoints: 0, identityPointReads: 0, moveChecks: 0, identityRejections: 0,
    prefixRejections: 0, moveRejections: 0, constraintRejections: 0,
    stores: 0, copiedPoints: 0, retainedPoints: 0, retainedEntries: 0,
    nativeSourceIterations: 0, sourceLength: 0, sourceVias: 0, sourceOddAngles: 0,
    hitSourceIterations: 0, hitSourceLength: 0, hitSourceVias: 0, hitSourceOddAngles: 0,
    rejectedWorkCap: 0, logicalWorkUnits: 0, recordPoints: 0, reusedCompletedRoutes: 0, nativeCompletedRoutes: 0,
  }
  private readonly entries = new Map<string, Entry[]>()
  private readonly starts = new WeakMap<Checker, Start>()
  private readonly bounds: ReturnType<typeof getBoundsFromNodeWithPortPoints>

  constructor(readonly node: NodeWithPortPoints) {
    if (!Object.isFrozen(node) || !Object.isFrozen(node.portPoints) ||
      node.portPoints.some((point) => !Object.isFrozen(point))) {
      throw new Error("Native route witness broker requires the candidate's owned frozen node")
    }
    this.bounds = getBoundsFromNodeWithPortPoints(node)
    const sceneKey = JSON.stringify(node, (_key: string, value: unknown): unknown => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite native witness scene")
      return typeof value === "number" && Object.is(value, -0) ? "number:-0" : value
    })
    this.diagnostics.ownedPortPoints = node.portPoints.length + (node.portPointsInPairs?.length ?? 0) * 2
    this.diagnostics.sceneSerializedBytes = Buffer.byteLength(sceneKey, "utf8")
  }

  private samePoint(a: Point, b: Point): boolean {
    return (
      Object.is(a.x, b.x) &&
      Object.is(a.y, b.y) &&
      a.z === b.z
    )
  }

  private keyFor(checker: Checker, prefix: Point[]): string | null {
    const b = checker.bounds
    if (checker.regionId !== this.node.capacityMeshNodeId ||
      !Object.is(b.minX, this.bounds.minX) || !Object.is(b.maxX, this.bounds.maxX) ||
      !Object.is(b.minY, this.bounds.minY) || !Object.is(b.maxY, this.bounds.maxY) ||
      !(checker.cellStep > 0) || !Number.isFinite(checker.cellStep) ||
      ![checker.traceThickness, checker.viaDiameter, checker.obstacleMargin].every((value) => Number.isFinite(value) && value >= 0)) return null
    const values = [checker.connectionName, checker.rootConnectionName, checker.regionId,
      checker.A, checker.B, checker.cellStep, checker.gridMinXIndex, checker.gridMinYIndex,
      checker.gridWidth, checker.gridHeight, checker.initialNodeGridOffset,
      checker.availableZ, checker.layerCount, checker.traceThickness, checker.viaDiameter,
      checker.obstacleMargin, prefix]
    const key = JSON.stringify(values, (_name: string, value: unknown): unknown => {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite native witness task")
      return typeof value === "number" && Object.is(value, -0) ? "number:-0" : value
    })
    this.diagnostics.keyBuilds++
    this.diagnostics.keyBytes += Buffer.byteLength(key, "utf8")
    return key
  }

  private currentStart(checker: Checker): Start | null {
    this.diagnostics.checkerStarts++
    if (Object.getPrototypeOf(checker) !== SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype) return null
    if (checker.solved || checker.failed || checker.iterations > 1) {
      this.diagnostics.constructorSolvedSkipped++
      return null
    }
    const initial = checker.candidates.peek()
    if (!initial) throw new Error("Fresh native witness checker has no initial candidate")
    const prefix = checker.getNodePath(initial).reverse().map((point): Point => ({ x: point.x, y: point.y, z: point.z }))
    if (prefix.length < 1 || prefix.length > 2 || !this.samePoint(prefix[0]!, checker.A)) return null
    const key = this.keyFor(checker, prefix)
    if (!key) return null
    const start = { key, prefix }
    this.starts.set(checker, start)
    return start
  }

  private validRouteIdentity(checker: Checker, route: HighDensityIntraNodeRoute): boolean {
    if (route.connectionName !== checker.connectionName || route.rootConnectionName !== checker.rootConnectionName ||
      route.regionId !== checker.regionId || !Object.is(route.traceThickness, checker.traceThickness) ||
      !Object.is(route.viaDiameter, checker.viaDiameter) || route.route.length < 2 ||
      !this.samePoint(route.route[0]!, checker.A) || !this.samePoint(route.route.at(-1)!, checker.B) ||
      route.jumpers?.length || route.startPcbPortId !== undefined || route.endPcbPortId !== undefined) return false
    for (const point of route.route) {
      this.diagnostics.identityPointReads++
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.z) ||
        !checker.availableZ.includes(point.z) || point.traceThickness !== undefined || point.pcb_port_id !== undefined ||
        point.insideJumperPad || point.toNextSegmentType !== undefined || point.toNextSegmentCircuitJsonMetadata !== undefined) return false
    }
    return true
  }

  private isNativeMove(checker: Checker, parent: Point, point: Point): boolean {
    if (point.z !== parent.z) return this.samePoint({ ...point, z: parent.z }, parent) && checker.availableZ.includes(point.z)
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      this.diagnostics.moveChecks++
      if (x === 0 && y === 0) continue
      const nx = Math.max(checker.bounds.minX, Math.min(parent.x + x * checker.cellStep, checker.bounds.maxX))
      const ny = Math.max(checker.bounds.minY, Math.min(parent.y + y * checker.cellStep, checker.bounds.maxY))
      if (Object.is(point.x, nx) && Object.is(point.y, ny)) return true
    }
    return false
  }

  private replay(checker: Checker, start: Start, entry: Entry): { accepted: boolean; points: number } {
    const route = entry.route
    this.diagnostics.replayAttempts++
    if (!this.validRouteIdentity(checker, route)) {
      this.diagnostics.identityRejections++
      return { accepted: false, points: 0 }
    }
    if (route.route.length <= start.prefix.length || start.prefix.some((point, index) => !this.samePoint(point, route.route[index]!))) {
      this.diagnostics.prefixRejections++
      return { accepted: false, points: 0 }
    }
    let parent: Node | null = null
    let visited = 0
    const vias: Point[] = []
    const keys = new Set<number | string>()
    for (let index = 0; index < route.route.length; index++) {
      if (++visited > MAX_REPLAY_POINTS) {
        this.diagnostics.rejectedWorkCap++
        return { accepted: false, points: visited }
      }
      this.diagnostics.replayPoints++
      const point = route.route[index]!
      const node: Node = { x: point.x, y: point.y, z: point.z, g: 0, h: 0, f: 0, parent }
      const last = index === route.route.length - 1
      if (index >= start.prefix.length) {
        if (!parent) throw new Error("Native witness replay lost its parent chain")
        const isVia = node.z !== parent.z
        if (last) {
          if (isVia || distance(parent, checker.B) > checker.cellStep * Math.SQRT2) {
            this.diagnostics.moveRejections++
            return { accepted: false, points: visited }
          }
          this.diagnostics.nativeReplayCalls++
          if (checker.doesPathToParentIntersectObstacle(node)) {
            this.diagnostics.constraintRejections++
            return { accepted: false, points: visited }
          }
        } else {
          if (!this.isNativeMove(checker, parent, node)) {
            this.diagnostics.moveRejections++
            return { accepted: false, points: visited }
          }
          this.diagnostics.nativeReplayCalls++
          const blocked = isVia ? checker.isNodeTooCloseToObstacle(node, checker.viaDiameter / 2 + checker.obstacleMargin / 2, true) : checker.isNodeTooCloseToObstacle(node)
          const edgeBlocked = !blocked && (this.diagnostics.nativeReplayCalls++, checker.isNodeTooCloseToEdge(node, isVia))
          if (blocked || edgeBlocked) {
            this.diagnostics.constraintRejections++
            return { accepted: false, points: visited }
          }
          if (!isVia) {
            this.diagnostics.nativeReplayCalls++
            if (checker.doesPathToParentIntersectObstacle(node)) {
              this.diagnostics.constraintRejections++
              return { accepted: false, points: visited }
            }
          }
        }
      }
      if (parent && parent.z !== node.z) vias.push({ x: parent.x, y: parent.y, z: parent.z })
      if (!last && index >= start.prefix.length - 1) {
        const key = checker.getNodeKey(node)
        if (keys.has(key)) {
          this.diagnostics.moveRejections++
          return { accepted: false, points: visited }
        }
        keys.add(key)
      }
      parent = node
    }
    if (vias.length !== route.vias.length || vias.some((via, index) => !Object.is(via.x, route.vias[index]!.x) || !Object.is(via.y, route.vias[index]!.y))) {
      this.diagnostics.identityRejections++
      return { accepted: false, points: visited }
    }
    return { accepted: true, points: visited }
  }

  /** Called once on the already-constructed, still-fresh CURRENT native search. */
  lookup(checker: Checker): NativeWitnessResult {
    this.diagnostics.lookups++
    const start = this.currentStart(checker)
    if (!start) return { route: null, workUnits: 0 }
    let points = 0
    const identityBefore = this.diagnostics.identityPointReads
    const entries = this.entries.get(start.key)
    if (!entries) {
      this.diagnostics.misses++
      this.diagnostics.logicalWorkUnits++
      return { route: null, workUnits: 1 }
    }
    for (const entry of entries) {
      const result = this.replay(checker, start, entry)
      points += result.points
      if (!result.accepted) continue
      this.diagnostics.hits++
      this.diagnostics.copiedPoints += entry.route.route.length
      this.diagnostics.hitSourceIterations += entry.sourceIterations
      this.diagnostics.hitSourceLength += entry.length
      this.diagnostics.hitSourceVias += entry.route.vias.length
      this.diagnostics.hitSourceOddAngles += entry.oddAngles
      // Each point may require up to nine exact move comparisons and three
      // native checks; original native constructors/index setup are retained.
      const workUnits = Math.max(1, Math.ceil((points * 12 + this.diagnostics.identityPointReads - identityBefore + entry.route.route.length) / 64))
      this.diagnostics.logicalWorkUnits += workUnits
      return { route: structuredClone(entry.route), workUnits }
    }
    const workUnits = Math.max(1, Math.ceil((points * 12 + this.diagnostics.identityPointReads - identityBefore) / 64))
    this.diagnostics.logicalWorkUnits += workUnits
    return { route: null, workUnits }
  }

  /** Only completions of searches admitted above can become new witnesses. */
  record(checker: Checker): number {
    const start = this.starts.get(checker)
    const route = checker.solvedPath
    if (!start || !checker.solved || checker.failed || !route || checker.iterations < 32 ||
      route.route.length > MAX_REPLAY_POINTS || !this.validRouteIdentity(checker, route) ||
      this.keyFor(checker, start.prefix) !== start.key) return 0
    const entries = this.entries.get(start.key) ?? []
    if (entries.length >= MAX_ENTRIES_PER_KEY || this.diagnostics.retainedEntries >= MAX_ENTRIES ||
      this.diagnostics.retainedPoints + route.route.length > MAX_POINTS) return 0
    let length = 0
    let oddAngles = 0
    for (let index = 1; index < route.route.length; index++) {
      const a = route.route[index - 1]!, b = route.route[index]!
      length += Math.hypot(a.x - b.x, a.y - b.y)
      if (a.z === b.z && a.x !== b.x && a.y !== b.y && Math.abs(Math.abs(a.x - b.x) - Math.abs(a.y - b.y)) > 1e-6) oddAngles++
    }
    entries.push({ route: structuredClone(route), sourceIterations: checker.iterations, length, oddAngles })
    this.entries.set(start.key, entries)
    this.diagnostics.stores++
    this.diagnostics.retainedEntries++
    this.diagnostics.retainedPoints += route.route.length
    this.diagnostics.copiedPoints += route.route.length
    this.diagnostics.nativeSourceIterations += checker.iterations
    this.diagnostics.sourceLength += length
    this.diagnostics.sourceVias += route.vias.length
    this.diagnostics.sourceOddAngles += oddAngles
    this.diagnostics.recordPoints += route.route.length
    const workUnits = Math.max(1, Math.ceil(route.route.length * 2 / 64))
    this.diagnostics.logicalWorkUnits += workUnits
    return workUnits
  }
}
