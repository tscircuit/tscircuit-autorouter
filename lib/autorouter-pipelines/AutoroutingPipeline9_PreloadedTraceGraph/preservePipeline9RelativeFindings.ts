import type { WitnessViaCertificate } from "./getPipeline9WitnessViaCertificate"
import type { RelativeGeometryDetails } from "./getPipeline9RelativeGeometryDetails"

type Input = { before: RelativeGeometryDetails; after: RelativeGeometryDetails; baseline: WitnessViaCertificate; candidate: WitnessViaCertificate }
type Preservation = { status: "PASS" | "UNKNOWN"; reason: string }

/** Preserve complete records and multiplicity. Only object-key order is ignored;
 * arrays within a finding, IDs, unrounded metrics and all metadata stay exact.
 */
function exactRecord(value: unknown, ancestors = new Set<object>()): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") return Number.isFinite(value) ? Object.is(value, -0) ? "-0" : JSON.stringify(value) : undefined
  if (typeof value !== "object" || value === undefined || ancestors.has(value)) return undefined
  const array = Array.isArray(value), keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== "string")) return undefined
  if (array) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined
    if (keys.length !== value.length + 1 || !Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean)) return undefined
  } else if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!(array && key === "length") && (!descriptor.enumerable || !("value" in descriptor))) return undefined
  }
  ancestors.add(value)
  const entries = array ? value.map((entry) => exactRecord(entry, ancestors)) : (keys as string[]).sort().map((key) => {
    const encoded = exactRecord((value as Record<string, unknown>)[key], ancestors)
    return encoded === undefined ? undefined : `${JSON.stringify(key)}:${encoded}`
  })
  ancestors.delete(value)
  if (entries.some((entry) => entry === undefined)) return undefined
  return array ? `[${entries.join(",")}]` : `{${entries.join(",")}}`
}

/** Anonymous hard constraints need no inferred electrical owner. Their entire
 * original record stays exact and the unchanged contact proof independently
 * excludes the moving bundle from their complete outer footprint.
 */
function isAnonymousHardObstacle(record: Record<string, any>): boolean {
  const obstacle = record.originalObstacle, owner = record.originalObstacleOwner
  if (!Number.isSafeInteger(record.originalObstacleIndex) || record.originalObstacleIndex < 0 || record.finding?.obstacleIndex !== record.originalObstacleIndex) return false
  if (!obstacle || !owner || owner.status !== "UNKNOWN" || typeof owner.reason !== "string" || owner.reason.length === 0 || Object.keys(owner).sort().join(",") !== "reason,status") return false
  if (!Array.isArray(obstacle.connectedTo) || obstacle.connectedTo.length !== 0 || !["rect", "oval"].includes(obstacle.type)) return false
  if (![obstacle.center?.x, obstacle.center?.y, obstacle.width, obstacle.height, obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) || obstacle.width <= 0 || obstacle.height <= 0) return false
  if (!Array.isArray(obstacle.layers) || obstacle.layers.length === 0 || new Set(obstacle.layers).size !== obstacle.layers.length || obstacle.layers.some((layer: unknown) => typeof layer !== "string" || !/^(top|bottom|inner[1-9][0-9]*)$/.test(layer))) return false
  if (obstacle.circuitJsonMetadata !== undefined && (obstacle.circuitJsonMetadata === null || typeof obstacle.circuitJsonMetadata !== "object" || Reflect.ownKeys(obstacle.circuitJsonMetadata).length !== 0)) return false
  const fields = new Set(["componentId", "type", "center", "width", "height", "layers", "connectedTo", "circuitJsonMetadata", "ccwRotationDegrees"])
  return Object.keys(obstacle).every((key) => fields.has(key))
}

/** This is a local improvement contract, never a clean-board qualification. */
export function preservePipeline9RelativeFindings({ before, after, baseline, candidate }: Input): Preservation {
  const unknown = (reason: string): Preservation => ({ status: "UNKNOWN", reason })
  const target = baseline.copper.allFindings
  if (!Array.isArray(target) || target.length !== 1 || target[0]?.checkClass !== "viaTrace" || target[0]?.classification !== "DECLARED_FOREIGN_COPPER" || !Array.isArray(candidate.copper.allFindings) || candidate.copper.allFindings.length !== 0) return unknown("The one strict via-trace target was not removed without new strict findings")
  const oldReasons = exactRecord(baseline.reasons), newReasons = exactRecord(candidate.reasons)
  if (oldReasons === undefined || newReasons === undefined || !Array.isArray(baseline.reasons) || !Array.isArray(candidate.reasons) || [...baseline.reasons, ...candidate.reasons].some((value) => typeof value !== "string")) return unknown("Global reason records are unsupported")
  if (baseline.status !== "UNKNOWN" || candidate.status !== baseline.status || oldReasons !== newReasons || baseline.demandsChecked !== candidate.demandsChecked || baseline.referenceErrorCount !== candidate.referenceErrorCount) return unknown("The complete global certificate status/reasons/demands/reference changed")
  if ([baseline, candidate].some((certificate) => certificate.copper.allPublishedCopperChecksRun !== true || certificate.copper.ownershipCoverageStatus !== "COMPLETE") || candidate.copper.qualifiedSupportedCopper !== true) return unknown("Detailed preservation requires complete original-owner checks")
  if (!Array.isArray(baseline.reasons) || !Array.isArray(candidate.reasons) || !Number.isSafeInteger(baseline.demandsChecked) || baseline.demandsChecked < 0 || !Number.isSafeInteger(baseline.referenceErrorCount) || baseline.referenceErrorCount < 0) return unknown("Global certificate scope is unsupported")
  if (exactRecord(before.boardReasons) === undefined || exactRecord(after.boardReasons) === undefined || !Array.isArray(before.boardReasons) || !Array.isArray(after.boardReasons) || before.boardReasons.length !== 0 || after.boardReasons.length !== 0) return unknown("Existing board-envelope defects are outside the localized domain")
  const checks = ["viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"]
  for (const certificate of [baseline, candidate]) {
    if (exactRecord(certificate.copper.checksRun) !== exactRecord(checks)) return unknown("Every strict copper predicate must be explicitly performed")
    for (const check of checks) {
      const row = certificate.copper.checks?.[check]
      const expected = certificate === baseline && check === "viaTrace" ? 1 : 0
      if (!row || row.count !== expected || !Array.isArray(row.findings) || row.findings.length !== expected || row.unknownFindingCount !== 0 || row.sameOwnerRuleFindingCount !== 0 || row.knownForeignFindingCount !== expected) return unknown("Strict predicate populations are incomplete or incoherent")
    }
  }
  const keys = ["nativeErrors", "nativeErrorsWithCenters", "nativeLocationAwareErrors", "viaInPad", "srjObstacles", "viaPadPolicy"] as const
  for (const key of keys) {
    if (!Array.isArray(before[key]) || !Array.isArray(after[key]) || exactRecord(before[key]) === undefined || exactRecord(after[key]) === undefined) return unknown("A detailed predicate was not performed")
    const oldRecords = before[key].map((record) => exactRecord(record)), newRecords = after[key].map((record) => exactRecord(record))
    if (oldRecords.some((value) => value === undefined) || newRecords.some((value) => value === undefined)) return unknown("A detailed finding has unsupported/nonfinite data")
    if (JSON.stringify(oldRecords.sort()) !== JSON.stringify(newRecords.sort())) return unknown(`Untargeted ${key} records changed`)
  }
  for (const details of [before, after]) for (const key of ["srjObstacles", "viaPadPolicy"] as const) {
    if (!Array.isArray(details[key]) || details[key].some((record) => !record || record.originalObstacleOwner?.status !== "RESOLVED" && !isAnonymousHardObstacle(record) || !record.originalObstacle || !record.route || !record.raw)) return unknown("An untargeted physical finding has ambiguous original participants")
  }
  for (const [details, certificate] of [[before, baseline], [after, candidate]] as const) {
    if (details.nativeErrors.length !== certificate.referenceErrorCount || details.viaInPad.length !== certificate.viaInPadViolationCount || details.srjObstacles.length !== certificate.srjObstacleViolationCount || details.viaPadPolicy.length !== certificate.viaPadPolicyViolationCount) return unknown("Detailed records do not match their full-certificate populations")
  }
  return { status: "PASS", reason: "One strict target removed; every other complete geometry finding and global certificate scope is exact unchanged" }
}
