import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { Pipeline9IntentOwners, type OriginalIntentJson } from "./checkPipeline9OriginalIntentCopper"
import { getPipeline9WitnessViaCertificate, type WitnessViaCertificate, type WitnessViaSite } from "./getPipeline9WitnessViaCertificate"

type Params = {
  originalSrj: SimpleRouteJson
  pointPairs: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
  protectedTraces: SimplifiedPcbTrace[]
}
type Proposal = { x: number; y: number }
// A numerical safety margin is used only to propose geometry. Acceptance
// always runs the unchanged declared/published clearance predicates.
const PROPOSAL_MARGIN = 1e-5

/** A planned, bounded, single-site portfolio over final exported raw traces.
 * It never reroutes a board, changes a material, or recovers from an exception.
 * All work occurs within the caller's existing external request deadline.
 */
export class Pipeline9WitnessViaPadRepairSolver extends BaseSolver {
  readonly params: Params
  private output?: SimplifiedPcbTrace[]
  private initialized = false
  private selectedSite?: WitnessViaSite
  private selectedPoints: { traceIndex: number; pointIndex: number }[] = []
  private proposals: Proposal[] = []
  private proposalIndex = 0
  private originalInputBytes: string
  private originalTracesBytes: string
  private pointPairsBytes: string
  private protectedTracesBytes: string
  // A second bounded observer path preserves progress when nested stats and
  // the detailed ledger exceed the frozen observer's scalar/key limits.
  readonly qualification: Record<string, string | number | boolean | null> = {
    status: "UNINITIALIZED", initialForeignViaPadFindings: null,
    lastForeignViaPadFindings: null, bestForeignViaPadFindings: null,
    proposals: 0, accepted: 0, rejectionClass: null, protectedUnchanged: false,
    lastReferenceErrors: null, lastSrjObstacleViolations: null,
    lastViaPadPolicyViolations: null, lastViaInPadViolations: null,
    lastProofReasonCount: null, lastX: null, lastY: null,
    initialCertificateStatus: "UNKNOWN",
  }
  failureEvidence?: { reasons: string[]; site?: { x: number; y: number }; attemptedCandidates: number }

  constructor(params: Params) {
    super()
    this.params = params
    this.originalInputBytes = JSON.stringify(params.originalSrj)
    this.originalTracesBytes = JSON.stringify(params.traces)
    this.pointPairsBytes = JSON.stringify(params.pointPairs)
    this.protectedTracesBytes = JSON.stringify(params.protectedTraces)
    this.MAX_ITERATIONS = 20
    this.stats = { activated: true, status: "UNINITIALIZED", proposalCount: 0, acceptedCandidateCount: 0, certificateChecks: 0, demandsChecked: 0, candidateLedger: [] }
  }

  private assertInputsUnchanged(): void {
    if (JSON.stringify(this.params.originalSrj) !== this.originalInputBytes) {
      this.qualification.protectedUnchanged = false
      throw new Error("Witness via repair mutated the original input")
    }
    if (JSON.stringify(this.params.traces) !== this.originalTracesBytes) {
      this.qualification.protectedUnchanged = false
      throw new Error("Witness via repair mutated its baseline output")
    }
    if (JSON.stringify(this.params.pointPairs) !== this.pointPairsBytes || JSON.stringify(this.params.protectedTraces) !== this.protectedTracesBytes) {
      this.qualification.protectedUnchanged = false
      throw new Error("Witness via repair mutated protected point-pair/copper context")
    }
    this.qualification.protectedUnchanged = true
  }

  private noProposal(reasons: string[], certificate?: WitnessViaCertificate): void {
    this.assertInputsUnchanged()
    this.output = this.params.traces
    const uniqueReasons = [...new Set(reasons)]
    this.stats = { ...this.stats, status: "NO_PROPOSAL", reasons: uniqueReasons.slice(0, 8), reasonCount: reasons.length, reasonsTruncated: uniqueReasons.length > 8,
      initialCertificateStatus: certificate?.status ?? "UNKNOWN", finalCertificateStatus: certificate?.status ?? "UNKNOWN" }
    this.qualification.status = "NO_PROPOSAL"
    this.qualification.rejectionClass = certificate?.status === "PASS" ? "NONE" : certificate?.status === "FAIL" ? "OUTSIDE_SEARCH_SCOPE" : "UNSUPPORTED_PROOF"
    this.solved = true
  }

  private initialize(): void {
    this.initialized = true
    if (this.params.protectedTraces.length > 0) {
      this.noProposal(["Protected power-expansion/preloaded copper is outside the experiment scope"])
      return
    }
    this.qualification.status = "BASELINE_CERTIFYING"
    this.qualification.protectedUnchanged = false
    const certificate = getPipeline9WitnessViaCertificate(this.params.originalSrj, this.params.pointPairs, this.params.traces)
    this.stats.certificateChecks = Number(this.stats.certificateChecks) + 1
    this.stats.demandsChecked = certificate.demandsChecked
    this.stats.initialCertificateStatus = certificate.status
    this.qualification.initialCertificateStatus = certificate.status
    const initialForeign = certificate.copper.allPublishedCopperChecksRun === true && certificate.copper.ownershipCoverageStatus === "COMPLETE"
      ? certificate.copper.allFindings.filter((finding: OriginalIntentJson) => finding.checkClass === "viaPad" && finding.classification === "DECLARED_FOREIGN_COPPER").length
      : null
    this.qualification.initialForeignViaPadFindings = initialForeign
    this.qualification.bestForeignViaPadFindings = initialForeign
    this.qualification.lastReferenceErrors = certificate.referenceErrorCount
    this.qualification.lastSrjObstacleViolations = certificate.srjObstacleViolationCount
    this.qualification.lastViaPadPolicyViolations = certificate.viaPadPolicyViolationCount
    this.qualification.lastViaInPadViolations = certificate.viaInPadViolationCount
    this.qualification.lastProofReasonCount = certificate.reasons.length
    this.stats.initialCopperFindingCount = certificate.copper.allFindings.length
    this.stats.initialCopperFindingCounts = Object.fromEntries(Object.entries(certificate.copper.checks ?? {}).map(([name, value]) => [name, (value as OriginalIntentJson).count]))
    this.stats.initialReferenceErrorCount = certificate.referenceErrorCount
    this.stats.initialSrjObstacleViolationCount = certificate.srjObstacleViolationCount
    this.stats.initialViaPadPolicyViolationCount = certificate.viaPadPolicyViolationCount
    this.stats.initialViaInPadViolationCount = certificate.viaInPadViolationCount
    this.stats.initialOwnershipCoverage = certificate.copper.ownershipCoverageStatus ?? "UNKNOWN"
    this.stats.certificateScope = "Published original-owner copper predicates; declared-terminal physical contact model; original reference, SRJ obstacle envelopes and via policy. Not universal manufacturing."
    this.assertInputsUnchanged()
    if (certificate.status === "PASS") {
      this.noProposal(["Baseline has a complete supported certificate"], certificate)
      return
    }
    if (certificate.status === "UNKNOWN") {
      this.noProposal(certificate.reasons, certificate)
      return
    }
    const findings = certificate.copper.allFindings as OriginalIntentJson[]
    if (findings.length === 0 || findings.some((finding) => finding.checkClass !== "viaPad" || finding.classification !== "DECLARED_FOREIGN_COPPER")) {
      this.noProposal(["Only isolated original-foreign via-pad defects are eligible"], certificate)
      return
    }
    const sites = new Set<WitnessViaSite>()
    for (const finding of findings) {
      const viaParticipant = finding.owners.find((member: OriginalIntentJson) => member.type === "pcb_via")
      const viaRecord = certificate.copper.viaOwners.find((member: OriginalIntentJson) => member.originalId === viaParticipant?.id)
      const via = viaRecord ? certificate.circuitJson[viaRecord.canonicalIndex] : undefined
      const site = via ? certificate.sites.find((site) => site.x === via.x && site.y === via.y) : undefined
      if (!site) {
        this.noProposal(["Via witness has no exact raw physical occurrence group"], certificate)
        return
      }
      sites.add(site)
    }
    if (sites.size !== 1) {
      this.noProposal(["Multiple physical via sites require a different planned search"], certificate)
      return
    }
    this.selectedSite = [...sites][0]!
    const owners = new Pipeline9IntentOwners(this.params.originalSrj, this.params.pointPairs)
    for (const [traceIndex, trace] of this.params.traces.entries()) {
      const owner = owners.traceReference(trace.connection_name)
      for (const [pointIndex, point] of trace.route.entries()) {
        if (point.route_type !== "wire" && point.route_type !== "via") continue
        if (point.x !== this.selectedSite.x || point.y !== this.selectedSite.y) continue
        if (point.route_type === "wire" && !this.selectedSite.layers.includes(point.layer)) continue
        if (owner.status !== "RESOLVED" || owner.owner !== this.selectedSite.owner || pointIndex === 0 || pointIndex === trace.route.length - 1 ||
          (point.route_type === "wire" && (point.start_pcb_port_id !== undefined || point.end_pcb_port_id !== undefined))) {
          this.noProposal(["Selected site includes a protected or foreign terminal occurrence"], certificate)
          return
        }
        this.selectedPoints.push({ traceIndex, pointIndex })
      }
    }
    // Every raw via occurrence must move with its adjacent co-located copper.
    for (const occurrence of this.selectedSite.occurrences) {
      const trace = this.params.traces[occurrence.traceIndex]!
      const before = trace.route[occurrence.pointIndex - 1]
      const after = trace.route[occurrence.pointIndex + 1]
      if (before?.route_type !== "wire" || after?.route_type !== "wire" || before.x !== this.selectedSite.x || before.y !== this.selectedSite.y || after.x !== this.selectedSite.x || after.y !== this.selectedSite.y) {
        this.noProposal(["Selected via does not have exact movable raw adjacency"], certificate)
        return
      }
    }
    for (const finding of findings) {
      const padParticipant = finding.owners.find((member: OriginalIntentJson) => member.type === "pcb_smtpad" || member.type === "pcb_plated_hole")
      const padRecord = certificate.copper.padOwners.find((member: OriginalIntentJson) => member.originalId === padParticipant?.id)
      const pad = padRecord ? certificate.circuitJson[padRecord.canonicalIndex] : undefined
      if (!pad || pad.type !== "pcb_smtpad" || !["rect", "rotated_rect", "circle"].includes(pad.shape)) {
        this.noProposal(["Witness pad requires an unsupported proposal shape"], certificate)
        return
      }
      this.proposals.push(...this.padFaceProposals(pad, finding.error.minimum_clearance))
    }
    const unique = new Map(this.proposals.map((point) => [JSON.stringify([point.x, point.y]), point]))
    this.proposals = [...unique.values()].sort((a, b) => Math.hypot(a.x - this.selectedSite!.x, a.y - this.selectedSite!.y) - Math.hypot(b.x - this.selectedSite!.x, b.y - this.selectedSite!.y))
    // Single-site shape proposals, bounded independently of dataset identity.
    this.proposals = this.proposals.slice(0, 16)
    this.stats.status = "SEARCHING"
    this.qualification.status = "SEARCHING"
    this.stats.movablePointCount = this.selectedPoints.length
    this.stats.selectedViaOccurrenceCount = this.selectedSite.occurrences.length
  }

  private padFaceProposals(pad: OriginalIntentJson, minimum: number): Proposal[] {
    if (!this.selectedSite || !Number.isFinite(minimum) || minimum < 0) throw new Error("Invalid original via-pad witness")
    const site = this.selectedSite
    const angle = ((pad.ccw_rotation ?? 0) * Math.PI) / 180
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const dx = site.x - pad.x
    const dy = site.y - pad.y
    const x = dx * cosine + dy * sine
    const y = -dx * sine + dy * cosine
    const requestedClearance = Math.max(minimum, this.params.originalSrj.defaultObstacleMargin ?? 0, this.params.originalSrj.minViaEdgeToPadEdgeClearance ?? 0)
    const margin = site.diameter / 2 + requestedClearance + PROPOSAL_MARGIN
    const local = pad.shape === "circle"
      ? Array.from({ length: 4 }, (_, index) => {
          const theta = Math.atan2(y, x) + index * Math.PI / 2
          return { x: Math.cos(theta) * (pad.radius + margin), y: Math.sin(theta) * (pad.radius + margin) }
        })
      : [{ x: -pad.width / 2 - margin, y }, { x: pad.width / 2 + margin, y }, { x, y: -pad.height / 2 - margin }, { x, y: pad.height / 2 + margin }]
    return local.map((point) => ({ x: pad.x + point.x * cosine - point.y * sine, y: pad.y + point.x * sine + point.y * cosine }))
  }

  override _step(): void {
    if (!this.initialized) {
      this.initialize()
      return
    }
    if (!this.selectedSite) throw new Error("Witness search has no selected raw site")
    const proposal = this.proposals[this.proposalIndex++]
    if (!proposal) {
      this.failureEvidence = { reasons: ["No fully certified pad-face proposal"], site: { x: this.selectedSite.x, y: this.selectedSite.y }, attemptedCandidates: this.proposalIndex - 1 }
      this.stats.status = "SEARCH_EXHAUSTED"
      this.qualification.status = "SEARCH_EXHAUSTED"
      throw new Error("Witness via-pad repair exhausted its planned candidates without a certified result")
    }
    const candidate = structuredClone(this.params.traces)
    for (const occurrence of this.selectedPoints) {
      const point = candidate[occurrence.traceIndex]!.route[occurrence.pointIndex]!
      if (point.route_type !== "wire" && point.route_type !== "via") throw new Error("Witness mutation mask changed primitive type")
      point.x = proposal.x
      point.y = proposal.y
    }
    this.stats.proposalCount = Number(this.stats.proposalCount) + 1
    this.qualification.status = "CANDIDATE_CERTIFYING"
    this.qualification.protectedUnchanged = false
    this.qualification.proposals = this.proposalIndex
    this.qualification.lastX = proposal.x
    this.qualification.lastY = proposal.y
    const certificate = getPipeline9WitnessViaCertificate(this.params.originalSrj, this.params.pointPairs, candidate)
    this.stats.certificateChecks = Number(this.stats.certificateChecks) + 1
    this.stats.lastCandidateCertificateStatus = certificate.status
    this.stats.lastRejectionReasons = certificate.reasons.slice(0, 8)
    this.stats.lastCandidateCopperFindingCount = certificate.copper.allFindings.length
    this.stats.lastCandidateReferenceErrorCount = certificate.referenceErrorCount
    this.stats.lastCandidateViaInPadViolationCount = certificate.viaInPadViolationCount
    const performed = certificate.copper.allPublishedCopperChecksRun === true && certificate.copper.ownershipCoverageStatus === "COMPLETE"
    const foreignViaPadFindings: number | null = performed
      ? certificate.copper.allFindings.filter((finding: OriginalIntentJson) => finding.checkClass === "viaPad" && finding.classification === "DECLARED_FOREIGN_COPPER").length
      : null
    this.qualification.lastForeignViaPadFindings = foreignViaPadFindings
    const best = this.qualification.bestForeignViaPadFindings
    if (foreignViaPadFindings !== null) this.qualification.bestForeignViaPadFindings = typeof best === "number" ? Math.min(best, foreignViaPadFindings) : foreignViaPadFindings
    this.qualification.lastReferenceErrors = certificate.referenceErrorCount
    this.qualification.lastSrjObstacleViolations = certificate.srjObstacleViolationCount
    this.qualification.lastViaPadPolicyViolations = certificate.viaPadPolicyViolationCount
    this.qualification.lastViaInPadViolations = certificate.viaInPadViolationCount
    this.qualification.lastProofReasonCount = certificate.reasons.length
    this.qualification.rejectionClass = certificate.status === "UNKNOWN" ? "PROOF_INCOMPLETE"
      : certificate.referenceErrorCount > 0 ? "REFERENCE"
      : certificate.srjObstacleViolationCount > 0 ? "SRJ_ENVELOPE"
      : certificate.viaPadPolicyViolationCount > 0 ? "VIA_PAD_POLICY"
      : certificate.viaInPadViolationCount > 0 ? "VIA_IN_PAD"
      : certificate.copper.allFindings.length > 0 ? "ORIGINAL_OWNER_COPPER"
      : certificate.status === "FAIL" ? "BOARD_ENVELOPE" : "NONE"
    ;(this.stats.candidateLedger as OriginalIntentJson[]).push({ proposal: this.proposalIndex, x: proposal.x, y: proposal.y, status: certificate.status,
      foreignViaPadFindings, publishedCopperChecksComplete: performed, ownershipCoverage: certificate.copper.ownershipCoverageStatus ?? "UNKNOWN",
      viaPadPolicyViolations: certificate.viaPadPolicyViolationCount, viaInPadViolations: certificate.viaInPadViolationCount,
      referenceErrors: certificate.referenceErrorCount, srjObstacleViolations: certificate.srjObstacleViolationCount,
      reasons: certificate.reasons.slice(0, 4) })
    this.assertInputsUnchanged()
    if (certificate.status !== "PASS") {
      this.qualification.status = "REJECTED"
      return
    }
    this.output = candidate
    this.stats.status = "ACCEPTED"
    this.stats.finalCertificateStatus = "PASS"
    this.stats.acceptedCandidateCount = 1
    this.qualification.accepted = 1
    this.qualification.status = "ACCEPTED"
    this.solved = true
  }

  getOutput(): SimplifiedPcbTrace[] {
    if (!this.solved || this.failed || this.output === undefined) {
      throw new Error("Witness via-pad output requires completed successful search/no-proposal status")
    }
    this.assertInputsUnchanged()
    return this.output
  }
}
