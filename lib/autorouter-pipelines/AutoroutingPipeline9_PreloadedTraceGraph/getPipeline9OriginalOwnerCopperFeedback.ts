import {
  checkViaPadClearance, checkPadTraceClearance, checkViaTraceClearance,
  checkEachPcbTraceNonOverlapping, checkDifferentNetViaSpacing,
  checkSameNetViaSpacing, checkPadPadClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { checkPipeline9OriginalIntentCopper } from "./checkPipeline9OriginalIntentCopper"
import { filterPipeline9DrcErrorsAgainstBaseline } from "./filterPipeline9DrcErrorsAgainstBaseline"

type Data = Record<string, unknown>
export type OriginalOwnerCopperFeedback =
  | { status: "NOT_APPLICABLE"; reason: string; unsupportedOwnerCount: number; errors: [] }
  | { status: "SUPPORTED"; reason: null; unsupportedOwnerCount: 0; errors: Data[] }

export type OriginalOwnerCopperFeedbackStats = {
  version: 1
  enabled: true
  status: "SUPPORTED" | "NOT_APPLICABLE"
  reason: string | null
  originalOwnershipCoverage: "COMPLETE" | "UNKNOWN"
  selectedCheckCount: 2
  completePredicateSuite: boolean
  baselineIssueCount: number | null
  initialIssueCount: number | null
  referenceEvaluations: number
  appendedIssueCount: number
  baselineMatchesFiltered: number
  unsupportedOwnerCount: number | null
  latestIssueCount: number | null
}

const idField = (type: unknown): string => {
  if (type === "pcb_trace") return "pcb_trace_id"
  if (type === "pcb_via") return "pcb_via_id"
  if (type === "pcb_smtpad") return "pcb_smtpad_id"
  if (type === "pcb_plated_hole") return "pcb_plated_hole_id"
  throw new Error("Original-owner feedback has an unsupported copper member")
}

const stableGeometry = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableGeometry)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !key.endsWith("_id") && !key.endsWith("_ids"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, key === "layers" && Array.isArray(item) ? [...item].sort() : stableGeometry(item)]))
}

/** Add published copper predicates using declared owners, without generated source edges. */
export const getPipeline9OriginalOwnerCopperFeedback = ({
  originalSrj, srjWithPointPairs, routedTraces, circuitJson,
  originalTraceIdByPreparedTraceId = new Map(),
}: {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
  circuitJson: AnyCircuitElement[]
  originalTraceIdByPreparedTraceId?: ReadonlyMap<string, string>
}): OriginalOwnerCopperFeedback => {
  const report = checkPipeline9OriginalIntentCopper({ original: originalSrj,
    pointPairs: srjWithPointPairs, traces: routedTraces, circuitJson }, {
    viaPad: checkViaPadClearance, padTrace: checkPadTraceClearance,
    viaTrace: checkViaTraceClearance, traceOverlap: checkEachPcbTraceNonOverlapping,
    differentNetViaSpacing: checkDifferentNetViaSpacing,
    sameNetViaSpacing: checkSameNetViaSpacing, padPad: checkPadPadClearance,
  })
  if (report.allPublishedCopperChecksRun !== true) {
    throw new Error("Original-owner feedback did not execute the complete pinned copper suite")
  }
  if (report.ownershipCoverageStatus !== "COMPLETE") return {
    status: "NOT_APPLICABLE", reason: "Original declared copper ownership or geometry is incomplete",
    unsupportedOwnerCount: report.unknownViaCount + report.unknownTraceCount + report.unknownPadCount +
      report.originalObstacleCoverage.unmappedDeclaredCopperCount, errors: [],
  }
  const source = circuitJson as unknown as Data[]
  const idCounts = new Map<string, number>()
  for (const element of source) {
    if (!["pcb_trace", "pcb_via", "pcb_smtpad", "pcb_plated_hole"].includes(String(element.type))) continue
    const id = element[idField(element.type)]
    if (typeof id !== "string" || id.length === 0) throw new Error("Supported original-owner copper lacks an actual identity")
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1)
  }
  if ([...idCounts.values()].some((count) => count !== 1)) {
    return { status: "NOT_APPLICABLE", reason: "Original copper identities are ambiguous", unsupportedOwnerCount: 1, errors: [] }
  }
  const errors = new Map<string, Data>()
  for (const finding of report.allFindings) {
    if (finding.checkClass !== "viaTrace" && finding.checkClass !== "traceOverlap") continue
    if (finding.classification === "UNKNOWN_OWNER_COPPER" || finding.owners.length === 0 ||
      finding.canonicalIndexes.length !== finding.owners.length) {
      throw new Error("Complete original-owner feedback lost a finding participant")
    }
    if (finding.classification !== "DECLARED_FOREIGN_COPPER") continue
    const members = finding.owners.map((owner: Data, index: number): { owner: Data; element: Data; id: string } => {
      const position = finding.canonicalIndexes[index]
      const element = Number.isSafeInteger(position) ? source[position] : undefined
      if (!element || element.type !== owner.type || element[idField(owner.type)] !== owner.id ||
        owner.status !== "RESOLVED" || typeof owner.owner !== "string" || typeof owner.id !== "string") {
        throw new Error("Complete original-owner feedback has inconsistent actual copper binding")
      }
      return { owner, element, id: owner.id }
    })
    const viaIds = members.filter((member: { element: Data }) => member.element.type === "pcb_via")
      .map((member: { id: string }) => member.id)
    const traceIds = [...new Set<string>(members.flatMap((member: { element: Data; id: string }) => {
      if (member.element.type === "pcb_trace") return [member.id]
      if (member.element.type !== "pcb_via") return []
      if (typeof member.element.pcb_trace_id !== "string" || idCounts.get(member.element.pcb_trace_id) !== 1) {
        throw new Error("Supported original-owner via lost its unique actual trace")
      }
      return [member.element.pcb_trace_id]
    }))]
    if (traceIds.length === 0) throw new Error("Original-owner feedback cannot target a copper trace")
    const participants = members.map((member: { owner: Data; element: Data; id: string }) => {
      const traceId = member.element.type === "pcb_via" ? member.element.pcb_trace_id :
        member.element.type === "pcb_trace" ? member.id : undefined
      const stableId = typeof traceId === "string" ? originalTraceIdByPreparedTraceId.get(traceId) ?? traceId : member.id
      return JSON.stringify([member.element.type, member.owner.owner, stableId, stableGeometry(member.element)])
    }).sort()
    const key = JSON.stringify([finding.checkClass, participants])
    const error = finding.error as Data
    const primary = error.pcb_trace_id
    if (typeof primary !== "string" || !traceIds.includes(primary)) {
      throw new Error("Original-owner feedback has no actual primary trace target")
    }
    const others = members.map((member: { id: string }) => member.id).filter((id: string) => id !== primary)
    if (others.length !== 1) throw new Error("Original-owner feedback has an ambiguous copper pair")
    errors.set(key, { ...error, pcb_trace_ids: traceIds,
      ...(viaIds.length ? { pcb_via_id: viaIds[0], pcb_via_ids: viaIds } : {}),
      ...(finding.checkClass === "traceOverlap" ? {
        pcb_trace_error_id: `overlap_${primary}_${others[0]}`,
        originalOwnerCopperFeedbackOtherId: others[0],
      } : { pcb_via_trace_clearance_error_id: `via_trace_clearance_${viaIds[0]}_${primary}` }),
      originalOwnerCopperFeedbackKey: key,
    })
  }
  return { status: "SUPPORTED", reason: null, unsupportedOwnerCount: 0, errors: [...errors.values()] }
}

/** Retain native findings; attach strict identity to an identical native pair once. */
export const mergePipeline9OriginalOwnerCopperFeedback = (
  nativeErrors: Data[], additions: Data[],
): { errors: Data[]; appendedCount: number } => {
  const errors = [...nativeErrors]
  let appendedCount = 0
  for (const addition of additions) {
    const nativeIndex = errors.findIndex((error) => {
      if (error.type !== addition.type || error.pcb_trace_id !== addition.pcb_trace_id) return false
      if (error.originalOwnerCopperFeedbackKey !== undefined) return error.originalOwnerCopperFeedbackKey === addition.originalOwnerCopperFeedbackKey
      if (addition.type === "pcb_via_trace_clearance_error") return error.pcb_via_id === addition.pcb_via_id
      return typeof addition.originalOwnerCopperFeedbackOtherId === "string" &&
        error.pcb_trace_error_id === `overlap_${String(addition.pcb_trace_id)}_${addition.originalOwnerCopperFeedbackOtherId}`
    })
    if (nativeIndex === -1) { errors.push(addition); appendedCount++; continue }
    const native = errors[nativeIndex]!
    errors[nativeIndex] = { ...addition, ...native,
      originalOwnerCopperFeedbackKey: addition.originalOwnerCopperFeedbackKey,
      ...(native.pcb_trace_ids === undefined ? { pcb_trace_ids: addition.pcb_trace_ids } : {}),
      ...(native.pcb_via_id === undefined && addition.pcb_via_id !== undefined ? { pcb_via_id: addition.pcb_via_id, pcb_via_ids: addition.pcb_via_ids } : {}),
    }
  }
  return { errors, appendedCount }
}

/** Feedback contacts use physical identity; ordinary native findings retain their filter. */
export const filterPipeline9OriginalOwnerCopperFeedbackErrors = <TError extends Data>({
  errors, baselineErrors, originalTraceIdByPreparedTraceId,
}: {
  errors: TError[]
  baselineErrors: Data[]
  originalTraceIdByPreparedTraceId?: ReadonlyMap<string, string>
}): TError[] => {
  const ordinary = new Set(filterPipeline9DrcErrorsAgainstBaseline({
    errors: errors.filter((error) => error.originalOwnerCopperFeedbackKey === undefined),
    baselineErrors: baselineErrors.filter((error) => error.originalOwnerCopperFeedbackKey === undefined),
    originalTraceIdByPreparedTraceId,
  }))
  const inherited = new Set(baselineErrors.map((error) => error.originalOwnerCopperFeedbackKey)
    .filter((key): key is string => typeof key === "string"))
  return errors.filter((error) => error.originalOwnerCopperFeedbackKey === undefined ? ordinary.has(error) :
    typeof error.originalOwnerCopperFeedbackKey !== "string" || !inherited.has(error.originalOwnerCopperFeedbackKey))
}
