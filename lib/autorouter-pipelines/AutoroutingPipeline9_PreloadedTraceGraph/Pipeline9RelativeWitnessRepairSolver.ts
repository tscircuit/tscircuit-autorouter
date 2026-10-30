import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { Pipeline9IntentOwners, type OriginalIntentJson } from "./checkPipeline9OriginalIntentCopper"
import { checkBoardEnvelope, getPipeline9WitnessViaCertificate, type WitnessViaCertificate } from "./getPipeline9WitnessViaCertificate"
import { provePipeline9RelativeContacts, type RelativeWitnessMove } from "./provePipeline9RelativeContacts"
import { isCopperPointWithinRadius, type CopperPoint } from "./relativeCopperSweepGeometry"

type Params = { originalSrj: SimpleRouteJson; pointPairs: SimpleRouteJson; traces: SimplifiedPcbTrace[]; protectedTraces: SimplifiedPcbTrace[] }
type WireWitness = { traceIndex: number; pointIndex: number; obstacleIndex: number; severity: number }
type Proposal = { moves: RelativeWitnessMove[] }
const PROPOSAL_MARGIN = 0.001

/** A local coordinate repair with a relative electrical-contact certificate.
 * The full global certificate is retained verbatim, including UNKNOWN. This
 * mode never promotes that result to a solved-board or connectivity claim.
 */
export class Pipeline9RelativeWitnessRepairSolver extends BaseSolver {
  readonly params: Params
  baselineCertificate?: WitnessViaCertificate
  finalCertificate?: WitnessViaCertificate
  relativeProof?: ReturnType<typeof provePipeline9RelativeContacts>
  selectedMoves: RelativeWitnessMove[] = []
  readonly qualification: Record<string, string | number | boolean | null> = {
    status: "UNINITIALIZED", localRepaired: false, accepted: false,
    initialFullCertificateStatus: "UNKNOWN", finalFullCertificateStatus: "UNKNOWN",
    relativeStatus: "UNKNOWN", proposals: 0, beforeGeometryFindings: null,
    afterGeometryFindings: null, protectedUnchanged: false,
  }
  private initialized = false
  private proposals: Proposal[] = []
  private proposalIndex = 0
  private output?: SimplifiedPcbTrace[]
  private readonly inputBytes: string

  constructor(params: Params) {
    super()
    this.params = params
    this.inputBytes = JSON.stringify(params)
    this.MAX_ITERATIONS = 20
    this.stats = { status: "UNINITIALIZED", certificateChecks: 0, proposalCount: 0, localRepaired: false, globalAccepted: false, candidateLedger: [] }
  }

  private assertInputsUnchanged(): void {
    if (JSON.stringify(this.params) !== this.inputBytes) throw new Error("Relative witness repair mutated protected original/raw/context inputs")
    this.qualification.protectedUnchanged = true
  }

  private noProposal(reason: string): void {
    this.assertInputsUnchanged()
    this.output = this.params.traces
    this.selectedMoves = []
    this.qualification.status = "NO_PROPOSAL"
    this.stats.status = "NO_PROPOSAL"
    this.stats.reason = reason
    this.solved = true
  }

  private geometryCount(certificate: WitnessViaCertificate): number {
    return certificate.referenceErrorCount + certificate.srjObstacleViolationCount + certificate.viaPadPolicyViolationCount + certificate.viaInPadViolationCount + certificate.copper.allFindings.length
  }

  private getWireWitnesses(owners: Pipeline9IntentOwners): WireWitness[] {
    const original = this.params.originalSrj
    const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
    const obstacles = original.obstacles.map((obstacle) => {
      const owner = owners.obstacle(obstacle)
      return { ...obstacle, connectedTo: owner.status === "RESOLVED" ? [owner.owner] : [] }
    })
    const routes: HighDensityRoute[] = [], indices: { traceIndex: number; pointIndex: number }[] = []
    for (const [ti, trace] of this.params.traces.entries()) {
      const owner = owners.traceReference(trace.connection_name)
      if (owner.status !== "RESOLVED") throw new Error("Relative wire witness lost original owner coverage")
      for (let pi = 0; pi + 1 < trace.route.length; pi++) {
        const a = trace.route[pi]!, b = trace.route[pi + 1]!
        if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== b.layer) continue
        indices.push({ traceIndex: ti, pointIndex: pi })
        routes.push({ connectionName: owner.owner, rootConnectionName: owner.owner, traceThickness: Math.max(a.width, b.width), viaDiameter: original.minViaDiameter ?? 0.3, vias: [], route: [{ x: a.x, y: a.y, z: stack.indexOf(a.layer) }, { x: b.x, y: b.y, z: stack.indexOf(b.layer) }] })
      }
    }
    return getFixedObstacleViolations({ srj: { ...original, traces: undefined, connections: [], obstacles }, routes }).map((finding) => {
      const index = indices[finding.routeIndex]
      if (!index || finding.kind !== "wire") throw new Error("Relative wire witness did not bind its exact source segment")
      return { ...index, obstacleIndex: finding.obstacleIndex, severity: finding.severity }
    })
  }

  private initialize(): void {
    this.initialized = true
    if (this.params.protectedTraces.length > 0) { this.noProposal("Protected expansion/preloaded copper is outside the relative domain"); return }
    const certificate = getPipeline9WitnessViaCertificate(this.params.originalSrj, this.params.pointPairs, this.params.traces)
    this.baselineCertificate = this.finalCertificate = certificate
    this.stats.certificateChecks = 1
    this.qualification.initialFullCertificateStatus = this.qualification.finalFullCertificateStatus = certificate.status
    if (certificate.referenceErrorCount >= 0 && certificate.copper.allPublishedCopperChecksRun === true) this.qualification.beforeGeometryFindings = this.qualification.afterGeometryFindings = this.geometryCount(certificate)
    this.assertInputsUnchanged()
    if (certificate.copper.allPublishedCopperChecksRun !== true || certificate.copper.ownershipCoverageStatus !== "COMPLETE" || certificate.referenceErrorCount !== 0) { this.noProposal("Complete baseline original-owner geometry and reference checks are required"); return }
    const findings = certificate.copper.allFindings as OriginalIntentJson[]
    if (findings.length !== 1 || findings[0]!.checkClass !== "viaPad" || findings[0]!.classification !== "DECLARED_FOREIGN_COPPER") { this.noProposal("One isolated original-foreign via-pad finding is required"); return }
    const finding = findings[0]!
    const viaMember = finding.owners.find((value: OriginalIntentJson) => value.type === "pcb_via")
    const padMember = finding.owners.find((value: OriginalIntentJson) => value.type === "pcb_smtpad")
    const viaRecord = certificate.copper.viaOwners.find((value: OriginalIntentJson) => value.originalId === viaMember?.id)
    const padRecord = certificate.copper.padOwners.find((value: OriginalIntentJson) => value.originalId === padMember?.id)
    const via = viaRecord ? certificate.circuitJson[viaRecord.canonicalIndex] : undefined
    const pad = padRecord ? certificate.circuitJson[padRecord.canonicalIndex] : undefined
    const site = via ? certificate.sites.find((value) => value.x === via.x && value.y === via.y) : undefined
    if (!site || !pad || pad.type !== "pcb_smtpad" || pad.shape !== "rect" || (pad.ccw_rotation ?? 0) !== 0 || !Number.isFinite(finding.error.minimum_clearance)) { this.noProposal("The via-pad witness requires one supported raw site and solid axis-aligned SMT pad"); return }
    const owners = new Pipeline9IntentOwners(this.params.originalSrj, this.params.pointPairs)
    const siteOccurrences: { traceIndex: number; pointIndex: number }[] = []
    for (const [ti, trace] of this.params.traces.entries()) for (const [pi, point] of trace.route.entries()) {
      if ((point.route_type === "wire" || point.route_type === "via") && point.x === site.x && point.y === site.y && (point.route_type === "via" || site.layers.includes(point.layer))) siteOccurrences.push({ traceIndex: ti, pointIndex: pi })
    }
    const wireWitnesses = this.getWireWitnesses(owners)
    if (wireWitnesses.length > 1) { this.noProposal("Only one optional original-obstacle wire defect is in the planned search"); return }
    const offsets: (CopperPoint | undefined)[] = [undefined]
    const wire = wireWitnesses[0]
    if (wire) {
      offsets.length = 0
      const trace = this.params.traces[wire.traceIndex]!, a = trace.route[wire.pointIndex], b = trace.route[wire.pointIndex + 1]
      const obstacle = this.params.originalSrj.obstacles[wire.obstacleIndex]
      const owner = owners.traceReference(trace.connection_name), obstacleOwner = obstacle ? owners.obstacle(obstacle) : undefined
      if (!obstacle || obstacle.type !== "rect" || obstacle.shape !== undefined || (obstacle.ccwRotationDegrees ?? 0) !== 0 || !obstacle.circuitJsonMetadata?.pcb_smtpad_id || obstacle.layers.length !== 1 ||
        owner.status !== "RESOLVED" || obstacleOwner?.status !== "RESOLVED" || owner.owner === obstacleOwner.owner || a?.route_type !== "wire" || b?.route_type !== "wire" || a.layer !== b.layer || wire.pointIndex < 2 || wire.pointIndex + 3 >= trace.route.length || !Number.isFinite(wire.severity) || wire.severity <= 0) { this.noProposal("Wire witness is not one supported interior foreign-SMT segment"); return }
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
      if (!Number.isFinite(length) || length === 0) { this.noProposal("Wire witness has no finite nonzero normal"); return }
      let nx = -dy / length, ny = dx / length
      const side = ((a.x + b.x) / 2 - obstacle.center.x) * nx + ((a.y + b.y) / 2 - obstacle.center.y) * ny
      if (side === 0 || !Number.isFinite(side)) { this.noProposal("Wire witness outward normal is ambiguous"); return }
      if (side < 0) { nx = -nx; ny = -ny }
      for (const factor of [1, 2, 4, 8]) {
        const distance = Math.min(0.02 * (1 - 1e-9), (wire.severity + PROPOSAL_MARGIN) * factor)
        const offset = { x: nx * distance, y: ny * distance }
        if (!offsets.some((value) => value?.x === offset.x && value.y === offset.y)) offsets.push(offset)
      }
    }
    const clearance = Math.max(finding.error.minimum_clearance, this.params.originalSrj.defaultObstacleMargin ?? 0, this.params.originalSrj.minViaEdgeToPadEdgeClearance ?? 0)
    const edge = site.diameter / 2 + clearance + PROPOSAL_MARGIN
    const targets = [{ x: pad.x - pad.width / 2 - edge, y: site.y }, { x: pad.x + pad.width / 2 + edge, y: site.y }, { x: site.x, y: pad.y - pad.height / 2 - edge }, { x: site.x, y: pad.y + pad.height / 2 + edge }]
      .filter((target) => isCopperPointWithinRadius(site, target, 0.25))
      .sort((a, b) => Math.hypot(a.x - site.x, a.y - site.y) - Math.hypot(b.x - site.x, b.y - site.y))
    for (const target of targets) for (const offset of offsets) {
      const moves: RelativeWitnessMove[] = [{ kind: "via", occurrences: siteOccurrences.map((value) => ({ ...value, oldXY: { x: site.x, y: site.y }, newXY: target })) }]
      if (wire && offset) moves.push({ kind: "wire", occurrences: [wire.pointIndex, wire.pointIndex + 1].map((pointIndex) => {
        const point = this.params.traces[wire.traceIndex]!.route[pointIndex] as CopperPoint
        return { traceIndex: wire.traceIndex, pointIndex, oldXY: { x: point.x, y: point.y }, newXY: { x: point.x + offset.x, y: point.y + offset.y } }
      }) })
      this.proposals.push({ moves })
    }
    this.proposals = this.proposals.slice(0, 16)
    if (this.proposals.length === 0) { this.noProposal("No supported face proposal fits the hard movement bounds"); return }
    this.stats.status = this.qualification.status = "SEARCHING"
  }

  override _step(): void {
    if (!this.initialized) { this.initialize(); return }
    const proposal = this.proposals[this.proposalIndex++]
    if (!this.baselineCertificate) throw new Error("Relative search lost its baseline certificate")
    if (!proposal) {
      this.noProposal("Every planned local proposal was explicitly rejected")
      this.stats.status = this.qualification.status = "SEARCH_EXHAUSTED_UNCHANGED"
      const counts: Record<string, number> = {}
      for (const row of this.stats.candidateLedger as OriginalIntentJson[]) counts[row.reason] = (counts[row.reason] ?? 0) + 1
      this.stats.rejectionCounts = counts
      return
    }
    const candidate = structuredClone(this.params.traces)
    for (const move of proposal.moves) for (const occurrence of move.occurrences) Object.assign(candidate[occurrence.traceIndex]!.route[occurrence.pointIndex]!, occurrence.newXY)
    const certificate = getPipeline9WitnessViaCertificate(this.params.originalSrj, this.params.pointPairs, candidate)
    this.stats.certificateChecks = Number(this.stats.certificateChecks) + 1
    this.stats.proposalCount = this.qualification.proposals = this.proposalIndex
    const geometryComplete = certificate.copper.allPublishedCopperChecksRun === true && certificate.copper.qualifiedSupportedCopper === true && certificate.copper.ownershipCoverageStatus === "COMPLETE" && certificate.referenceErrorCount === 0 && certificate.srjObstacleViolationCount === 0 && certificate.viaPadPolicyViolationCount === 0 && certificate.viaInPadViolationCount === 0 && certificate.copper.allFindings.length === 0 && checkBoardEnvelope(this.params.originalSrj, candidate, certificate.sites).length === 0
    const proof = geometryComplete ? provePipeline9RelativeContacts({ original: this.params.originalSrj, pointPairs: this.params.pointPairs, before: this.params.traces, after: candidate, moves: proposal.moves, baselineCertificate: this.baselineCertificate, candidateCertificate: certificate }) : undefined
    ;(this.stats.candidateLedger as OriginalIntentJson[]).push({ proposal: this.proposalIndex, fullStatus: certificate.status, geometryFindings: this.geometryCount(certificate), geometryComplete, relativeStatus: proof?.status ?? "UNKNOWN", reason: proof?.reason ?? "Geometry screens did not all pass" })
    this.assertInputsUnchanged()
    if (!geometryComplete || !proof || proof.status !== "PASS" || this.geometryCount(certificate) >= this.geometryCount(this.baselineCertificate)) return
    this.output = candidate
    this.finalCertificate = certificate
    this.relativeProof = proof
    this.selectedMoves = proposal.moves
    this.stats.status = this.qualification.status = "LOCAL_REPAIRED"
    this.stats.localRepaired = this.qualification.localRepaired = true
    this.qualification.finalFullCertificateStatus = certificate.status
    this.qualification.relativeStatus = proof.status
    this.qualification.afterGeometryFindings = this.geometryCount(certificate)
    this.solved = true
  }

  getOutput(): SimplifiedPcbTrace[] {
    if (!this.solved || this.failed || this.output === undefined) throw new Error("Relative repair output requires a completed proved local repair/no-proposal result")
    this.assertInputsUnchanged()
    return this.output
  }
}
