import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getObstacleRouteConnectivity } from "../../HyperHighDensitySolver/getObstacleRouteConnectivity"
import { ContactHalfspaceSolver, type ContactHalfspace } from "./ContactHalfspaceSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "./MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import {
  buildPolylineContactRows, collectPolylineContacts, contactPrimitiveDistance,
  type ContactPrimitive, type ContactVertex, type PolylineContact,
} from "./polylineContactGeometry"
import type { Candidate } from "./types1"
import {
  validatePolylineContactRoutes, type PolylineContactPhysicalContext,
} from "./validatePolylineContactRoutes"

type Params = ConstructorParameters<typeof MultiHeadPolyLineIntraNodeSolver3>[0] &
  PolylineContactPhysicalContext & {
    physicalCoordinateScale?: number
    contactWorkCap?: number
    contactDiagnostics?: Record<string, number>
  }
type ActiveSeed = {
  candidate: Candidate
  round: number
  side: number
  trust: number
  penalty: number
  vertices: ContactVertex[]
  contacts: PolylineContact[]
  originals: { x: number; y: number }[]
  merit: number
  qp?: ContactHalfspaceSolver
}
class ContactWorkLimitReached extends Error {}

/** Fixed topology, coupled XY refinement. No endpoint-force backend is invoked. */
export class MultiHeadPolylineContactSolver extends MultiHeadPolyLineIntraNodeSolver3 {
  readonly coordinateScale: number
  readonly workCap: number
  private readonly contactParams: Params
  private context?: PolylineContactPhysicalContext
  private modelPrepared = false
  private readonly aggregate?: Record<string, number>
  private readonly fixed: ContactPrimitive[] = []
  private readonly roots: string[] = []
  private readonly owners = new Map<string, number>()
  private active?: ActiveSeed
  private checks = 0
  private readonly maximumTrust: number

  constructor(params: Params) {
    const scale = params.physicalCoordinateScale ?? 1
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid polyline physical coordinate scale")
    super({ ...params, viaDiameter: params.viaDiameter * scale })
    this.coordinateScale = scale
    this.workCap = params.contactWorkCap ?? 300_000
    if (!Number.isSafeInteger(this.workCap) || this.workCap < 0)
      throw new Error("Contact work cap must be a finite nonnegative integer")
    for (const [name, value] of Object.entries({
      traceWidth: params.traceWidth, viaDiameter: params.viaDiameter,
      obstacleMargin: params.obstacleMargin,
      viaHoleDiameter: params.viaHoleDiameter ?? params.viaDiameter,
      drillGap: params.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      viaPadGap: params.viaToPadClearance ?? params.obstacleMargin,
    })) {
      const dimension = name === "traceWidth" || name === "viaDiameter" || name === "viaHoleDiameter"
      if (!Number.isFinite(value) || value < 0 || (dimension && value === 0))
        throw new Error(`Invalid contact physical rule ${name}`)
    }
    if (!Number.isSafeInteger(params.layerCount) || params.layerCount < 1)
      throw new Error("Invalid contact physical layer count")
    this.traceWidth = params.traceWidth * scale
    this.obstacleMargin = params.obstacleMargin * scale
    this.viaDiameter = params.viaDiameter * scale
    this.BOUNDARY_PADDING *= scale
    this.maximumTrust = Math.max(params.viaDiameter, params.traceWidth * 2) * scale
    this.aggregate = params.contactDiagnostics
    this.contactParams = { ...params }
    this.count("contactInstances")
    this.count("contactScaledInstances", Number(scale !== 1))
    // Keep the replaced MultiHead3 candidate's supervisor allowance. The
    // additional explicit work cap bounds model/dual/validation work inside it.
    this.MAX_ITERATIONS = 1000
  }

  get physicalContext(): PolylineContactPhysicalContext {
    if (!this.context) throw new Error("Contact physical context is prepared on the first selected step")
    return this.context
  }

  private prepareModel(): void {
    const params = this.contactParams
    const scale = this.coordinateScale
    const node = params.nodeWithPortPoints
    this.charge(1 + node.portPoints.length + 2 * (node.portPointsInPairs?.length ?? 0))
    const physicalNode: NodeWithPortPoints = {
      ...node, width: node.width / scale, height: node.height / scale,
      portPoints: node.portPoints.map((p) => ({
        ...p, x: node.center.x + (p.x - node.center.x) / scale,
        y: node.center.y + (p.y - node.center.y) / scale,
      })),
      portPointsInPairs: node.portPointsInPairs?.map(([a, b]) => [
        { ...a, x: node.center.x + (a.x - node.center.x) / scale, y: node.center.y + (a.y - node.center.y) / scale },
        { ...b, x: node.center.x + (b.x - node.center.x) / scale, y: node.center.y + (b.y - node.center.y) / scale },
      ]),
    }
    this.context = { ...params, nodeWithPortPoints: physicalNode }
    for (const port of node.portPoints) {
      if (this.owners.has(port.connectionName)) continue
      this.owners.set(port.connectionName, this.roots.length)
      this.roots.push(port.rootConnectionName ?? port.connectionName)
    }
    const routeNames = [...this.owners.keys()].map((connectionName) => ({
      connectionName, rootConnectionName: this.roots[this.owners.get(connectionName)!],
    }))
    this.charge(params.nodeWithPortPoints.portPoints.length + params.obstacles.length * (routeNames.length + 1))
    const connectivity = getObstacleRouteConnectivity({
      obstacles: params.obstacles, routes: routeNames, connMap: params.connMap,
    })
    for (let index = 0; index < params.obstacles.length; index++) {
      const obstacle = params.obstacles[index]!
      this.charge(1)
      const radius = Math.hypot(obstacle.width, obstacle.height) / 2 * scale
      if (!Number.isFinite(radius) || obstacle.width < 0 || obstacle.height < 0)
        throw new Error("Invalid fixed obstacle geometry in contact context")
      const reach = Math.max(this.traceWidth, this.viaDiameter) / 2 +
        Math.max(this.obstacleMargin, (params.viaToPadClearance ?? params.obstacleMargin) * scale) +
        Math.SQRT2 * this.maximumTrust
      const x = node.center.x + (obstacle.center.x - node.center.x) * scale
      const y = node.center.y + (obstacle.center.y - node.center.y) * scale
      if (x + radius + reach < this.bounds.minX || x - radius - reach > this.bounds.maxX ||
        y + radius + reach < this.bounds.minY || y - radius - reach > this.bounds.maxY) continue
      const layers = obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.flatMap((layer): number[] =>
        layer === "all" ? Array.from({ length: params.layerCount }, (_, z): number => z) :
          [mapLayerNameToZ(layer, params.layerCount)])
      if (layers.length === 0 || layers.some((z): boolean => !Number.isInteger(z) || z < 0 || z >= params.layerCount))
        throw new Error("Contact obstacle has no valid physical layer span")
      // A circumscribed disk conservatively encloses both rotated and axis-
      // aligned interpretations. Final acceptance uses actual board geometry.
      this.fixed.push({
        vertices: [{ point: { x, y }, variable: -1 }], radius,
        minZ: Math.min(...layers), maxZ: Math.max(...layers), owner: -1, via: false,
        excludedOwners: new Set(connectivity.connectedRouteNamesByObstacle[index]!
          .map((name): number => this.owners.get(name)!)),
      })
    }
    this.modelPrepared = true
    this.count("contactModelPreparations")
  }

  override getSolverName(): string {
    return "MultiHeadPolylineContactSolver"
  }

  private count(name: string, amount = 1): void {
    this.stats[name] = Number(this.stats[name] ?? 0) + amount
    if (this.aggregate) this.aggregate[name] = (this.aggregate[name] ?? 0) + amount
  }

  private charge(units: number): void {
    if (!Number.isSafeInteger(units) || units < 0) throw new Error("Invalid contact work reservation")
    if (this.checks + units > this.workCap) throw new ContactWorkLimitReached()
    this.checks += units
    this.count("contactWorkUnits", units)
  }

  private geometry(candidate: Candidate): { primitives: ContactPrimitive[]; vertices: ContactVertex[] } {
    const primitives: ContactPrimitive[] = [...this.fixed]
    const vertices: ContactVertex[] = []
    for (const line of candidate.polyLines) {
      this.charge(1 + line.mPoints.length * 3)
      const owner = this.owners.get(line.connectionName)
      if (owner === undefined) throw new Error(`Unknown contact route owner ${line.connectionName}`)
      const path = [line.start, ...line.mPoints, line.end]
      const pathVertices: ContactVertex[] = path.map((point, index): ContactVertex => {
        const vertex = { point, variable: index === 0 || index === path.length - 1 ? -1 : vertices.length * 2 }
        if (vertex.variable >= 0) vertices.push(vertex)
        return vertex
      })
      for (let index = 0; index < path.length - 1; index++) {
        if (path[index]!.z2 !== path[index + 1]!.z1)
          throw new Error("Inconsistent fixed layer topology in contact seed")
        primitives.push({
          vertices: [pathVertices[index]!, pathVertices[index + 1]!], radius: this.traceWidth / 2,
          minZ: path[index]!.z2, maxZ: path[index]!.z2, owner, via: false,
        })
      }
      for (let index = 0; index < path.length; index++) {
        const point = path[index]!
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          !this.availableZ.includes(point.z1) || !this.availableZ.includes(point.z2))
          throw new Error("Invalid coordinates or layer in contact seed")
        if (point.z1 === point.z2) continue
        primitives.push({
          vertices: [pathVertices[index]!], radius: this.viaDiameter / 2,
          minZ: this.physicalContext.allowBlindAndBuriedVias ? Math.min(point.z1, point.z2) : 0,
          maxZ: this.physicalContext.allowBlindAndBuriedVias ? Math.max(point.z1, point.z2) : this.physicalContext.layerCount - 1,
          owner, via: true,
        })
      }
    }
    return { primitives, vertices }
  }

  private inBounds(candidate: Candidate): boolean {
    return candidate.polyLines.every((line): boolean => line.mPoints.every((point): boolean => {
      const padding = (point.z1 === point.z2 ? this.traceWidth : this.viaDiameter) / 2 + this.BOUNDARY_PADDING
      return point.x >= this.bounds.minX + padding - 1e-9 && point.x <= this.bounds.maxX - padding + 1e-9 &&
        point.y >= this.bounds.minY + padding - 1e-9 && point.y <= this.bounds.maxY - padding + 1e-9
    }))
  }

  private routes(candidate: Candidate, physical: boolean): HighDensityIntraNodeRoute[] {
    const center = this.nodeWithPortPoints.center
    const scale = physical ? this.coordinateScale : 1
    return candidate.polyLines.map((line): HighDensityIntraNodeRoute => {
      const points = [line.start, ...line.mPoints, line.end]
      const xy = (point: { x: number; y: number }): { x: number; y: number } => ({
        x: center.x + (point.x - center.x) / scale, y: center.y + (point.y - center.y) / scale,
      })
      return {
        connectionName: line.connectionName,
        rootConnectionName: this.roots[this.owners.get(line.connectionName)!],
        regionId: this.nodeWithPortPoints.capacityMeshNodeId,
        traceThickness: this.physicalContext.traceWidth, viaDiameter: this.physicalContext.viaDiameter,
        route: points.flatMap((p) => p.z1 === p.z2 ? [{ ...xy(p), z: p.z1 }] :
          [{ ...xy(p), z: p.z1 }, { ...xy(p), z: p.z2 }]),
        vias: points.filter((p): boolean => p.z1 !== p.z2).map(xy),
      }
    })
  }

  private prepareRound(seed: ActiveSeed): void {
    const { primitives, vertices } = this.geometry(seed.candidate)
    const context = this.physicalContext
    const collection = collectPolylineContacts(primitives, {
      margin: this.obstacleMargin,
      viaGap: Math.max(0.1, context.obstacleMargin) * this.coordinateScale,
      viaPadGap: (context.viaToPadClearance ?? context.obstacleMargin) * this.coordinateScale,
      drillSeparation: ((context.viaHoleDiameter ?? context.viaDiameter) +
        (context.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1)) * this.coordinateScale,
      sameNet: (a, b): boolean => a === b || this.roots[a] === this.roots[b] ||
        Boolean(this.connMap?.areIdsConnected(this.roots[a]!, this.roots[b]!)),
    }, seed.trust, (units): void => this.charge(units))
    seed.vertices = vertices
    seed.contacts = collection.contacts
    seed.originals = vertices.map((v): { x: number; y: number } => ({ ...v.point }))
    seed.merit = seed.contacts.reduce((sum, contact): number =>
      sum + Math.max(0, contact.required + 1e-5 - contact.distance) ** 2, 0)
    this.count("contactEnvelopePairs", collection.envelopePairs)
    this.count("contactCertifiedDistantPairs", collection.distantPairs)
    this.count("contactActivePairs", seed.contacts.length)
    const mutualClearance = seed.contacts.every((contact): boolean =>
      contact.a.owner < 0 || contact.b.owner < 0 || contact.distance >= contact.required)
    if (mutualClearance && this.inBounds(seed.candidate)) {
      this.count("contactPhysicalValidations")
      const error = validatePolylineContactRoutes(this.routes(seed.candidate, true), context,
        (units): void => this.charge(units))
      if (error === null) {
        this.solvedRoutes = this.routes(seed.candidate, false)
        this.solved = true
        this.count("contactValidatedSolutions")
      } else {
        this.count("contactPhysicalRejections")
        this.stats.lastPhysicalRejection = error
        if (seed.merit <= 1e-16) this.active = undefined
      }
      // Circumscribed fixed-obstacle disks are conservative model geometry.
      // Actual full-board validation may accept a zero-violation physical
      // route before those proxy inequalities can become tight.
      if (this.solved || !this.active) return
    }
    if (vertices.length === 0) {
      this.count("contactUnknownFixedSeeds")
      this.active = undefined
      return
    }
    const rows: ContactHalfspace[] = []
    for (const contact of seed.contacts)
      rows.push(...buildPolylineContactRows(contact, contact.distance < contact.required ? seed.side : 0,
        (units): void => this.charge(units)))
    for (const vertex of vertices) {
      this.charge(4)
      const point = vertex.point
      const via = seed.candidate.polyLines.some((line): boolean => line.mPoints.some((p): boolean => p === point && p.z1 !== p.z2))
      const padding = (via ? this.viaDiameter : this.traceWidth) / 2 + this.BOUNDARY_PADDING
      for (const [axis, variable, minimum, maximum] of [
        ["x", vertex.variable, this.bounds.minX + padding, this.bounds.maxX - padding],
        ["y", vertex.variable + 1, this.bounds.minY + padding, this.bounds.maxY - padding],
      ] as const) {
        rows.push({ terms: [{ variable, coefficient: 1 }], maximum: Math.min(seed.trust, maximum - point[axis]), soft: false })
        rows.push({ terms: [{ variable, coefficient: -1 }], maximum: Math.min(seed.trust, point[axis] - minimum), soft: false })
      }
    }
    this.count("contactQpRounds")
    this.count("contactGeneratedRows", rows.length)
    seed.qp = new ContactHalfspaceSolver(vertices.length * 2, rows, seed.penalty,
      Math.min(40_000, this.workCap - this.checks), 64)
    this.charge(seed.qp.work)
    this.count("contactQpPreparationWork", seed.qp.work)
  }

  override _step(): void {
    try {
      this.stepContact()
    } catch (error) {
      if (!(error instanceof ContactWorkLimitReached)) throw error
      this.failed = true
      this.error = "Polyline contact solve unknown: bounded model work exhausted"
      this.count("contactWorkLimited")
    }
  }

  private stepContact(): void {
    if (this.iterations >= this.MAX_ITERATIONS) {
      this.failed = true
      this.error = "Polyline contact solve unknown: supervisor iteration allowance exhausted"
      this.count("contactIterationLimited")
      return
    }
    if (!this.modelPrepared) this.prepareModel()
    if (this.phase === "setup") {
      this.setupInitialPolyLines()
      this.phase = "solving"
      this.count("contactRetainedSeeds", this.candidates.length)
      this.count("contactInheritedSeedSetups")
      return
    }
    if (this.checks >= this.workCap) {
      this.failed = true
      this.error = "Polyline contact solve unknown: bounded QP work exhausted"
      this.count("contactWorkLimited")
      return
    }
    if (!this.active) {
      const candidate = this.candidates.shift()
      if (!candidate) {
        this.failed = true
        this.error = "Polyline contact solve unknown: fixed topology seeds exhausted"
        this.count("contactSeedExhaustions")
        return
      }
      this.lastCandidate = candidate
      this.active = {
        candidate, round: 0, side: 0, trust: this.maximumTrust, penalty: 1024,
        vertices: [], contacts: [], originals: [], merit: Infinity,
      }
      this.count("contactVisitedSeeds")
    }
    const seed = this.active
    if (!seed.qp) {
      this.prepareRound(seed)
      return
    }
    const previousChecks = seed.qp.checks
    const previousWork = seed.qp.work
    seed.qp.step()
    this.charge(seed.qp.work - previousWork)
    this.count("contactQpRowUpdates", seed.qp.checks - previousChecks)
    if (!seed.qp.solved) return
    const result = seed.qp.getOutput()
    this.count("contactQpSweeps", seed.qp.sweeps)
    seed.qp = undefined
    seed.round++
    if (result.status === "unknown") {
      this.count("contactUnknownQps")
      seed.side++
      seed.trust /= 2
    } else {
      this.count("contactNonstationaryProposals", Number(!result.stationary))
      for (let index = 0; index < seed.vertices.length; index++) {
        const vertex = seed.vertices[index]!
        vertex.point.x += result.displacement[vertex.variable]!
        vertex.point.y += result.displacement[vertex.variable + 1]!
      }
      const merit = seed.contacts.reduce((sum, contact): number => sum +
        Math.max(0, contact.required + 1e-5 - contactPrimitiveDistance(contact.a, contact.b)) ** 2, 0)
      this.charge(seed.contacts.length + seed.vertices.length)
      if (this.inBounds(seed.candidate) && (merit < 1e-16 || merit < seed.merit * (1 - 1e-5))) {
        this.count("contactAcceptedSteps")
        seed.trust = Math.min(this.maximumTrust, seed.trust * 1.25)
        seed.penalty = Math.min(1e8, seed.penalty * 4)
      } else {
        for (let index = 0; index < seed.vertices.length; index++)
          Object.assign(seed.vertices[index]!.point, seed.originals[index]!)
        this.count("contactRejectedSteps")
        seed.side++
        seed.trust /= 2
      }
    }
    if (seed.round >= 20 || seed.trust < this.maximumTrust / 256) {
      this.count("contactUnknownSeeds")
      this.active = undefined
    }
  }

  override tryFinalAcceptance(): void {
    // Only zero-slack whole-geometry and physical board validation can finish.
    this.stats.contactRelaxedAcceptanceDisabled = 1
  }
}
