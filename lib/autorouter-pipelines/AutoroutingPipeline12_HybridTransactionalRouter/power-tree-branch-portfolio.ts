import type { HybridCopperSegment } from "./transactional-copper-types"
import type { RegionJob, RegionSearchSpec } from "./worker-protocol"

const MAXIMUM_POWER_TREE_BRANCH_CANDIDATES = 4

export function createPowerTreeBranchSearches({
  job,
  search,
  searchIndex,
  addedTraces = [],
}: {
  job: RegionJob
  search: RegionSearchSpec
  searchIndex: number
  addedTraces?: readonly HybridCopperSegment[]
}): readonly RegionSearchSpec[] {
  if (job.coupling.kind !== "power" || job.coupling.topology !== "tree") {
    return Object.freeze([search])
  }
  const [originalStartTerminalId, goalTerminalId] =
    search.connectedTerminalIds
  if (!originalStartTerminalId || !goalTerminalId) {
    throw new Error(
      `power tree search ${search.searchId} must reference two terminals`,
    )
  }
  const connectedTerminals = new Map<
    string,
    RegionSearchSpec["start"]
  >()
  for (const previousSearch of job.searches.slice(0, searchIndex)) {
    const [startTerminalId, endTerminalId] =
      previousSearch.connectedTerminalIds
    if (!startTerminalId || !endTerminalId) {
      throw new Error(
        `power tree search ${previousSearch.searchId} must reference two terminals`,
      )
    }
    connectedTerminals.set(startTerminalId, previousSearch.start)
    connectedTerminals.set(endTerminalId, previousSearch.goal)
  }
  const terminalStarts = [...connectedTerminals.entries()]
    .filter(
      ([terminalId]) =>
        terminalId !== originalStartTerminalId && terminalId !== goalTerminalId,
    )
    .map(([terminalId, start]) => ({
      candidateId: `terminal:${terminalId}`,
      terminalId,
      start,
    }))
  const tapStarts = addedTraces.map((segment, segmentIndex) => ({
    candidateId: `tap:${segmentIndex}`,
    terminalId: originalStartTerminalId,
    start: projectPointOntoSegment({
      point: search.goal,
      segment,
    }),
  }))
  const seenStartKeys = new Set([
    powerTreeStartKey(search.start),
    powerTreeStartKey(search.goal),
  ])
  const alternativeStarts = [...terminalStarts, ...tapStarts]
    .sort(
      (first, second) =>
        Math.hypot(
          first.start.x - search.goal.x,
          first.start.y - search.goal.y,
        ) -
          Math.hypot(
            second.start.x - search.goal.x,
            second.start.y - search.goal.y,
          ) ||
        first.candidateId.localeCompare(second.candidateId),
    )
    .filter((candidate) => {
      const key = powerTreeStartKey(candidate.start)
      if (seenStartKeys.has(key)) return false
      seenStartKeys.add(key)
      return true
    })
    .slice(0, MAXIMUM_POWER_TREE_BRANCH_CANDIDATES - 1)
    .map((candidate, alternativeIndex) =>
      Object.freeze({
        ...search,
        searchId: `${search.searchId}:alternate-parent:${candidate.candidateId}:${alternativeIndex}`,
        start: candidate.start,
        connectedTerminalIds: Object.freeze([
          candidate.terminalId,
          goalTerminalId,
        ]),
      }),
    )
  return Object.freeze([search, ...alternativeStarts])
}

function projectPointOntoSegment({
  point,
  segment,
}: {
  point: RegionSearchSpec["goal"]
  segment: HybridCopperSegment
}): RegionSearchSpec["start"] {
  const deltaX = segment.end.x - segment.start.x
  const deltaY = segment.end.y - segment.start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - segment.start.x) * deltaX +
              (point.y - segment.start.y) * deltaY) /
              lengthSquared,
          ),
        )
  return Object.freeze({
    x: segment.start.x + deltaX * projection,
    y: segment.start.y + deltaY * projection,
    layer: segment.layer,
  })
}

function powerTreeStartKey(point: RegionSearchSpec["start"]): string {
  return `${point.layer}:${point.x.toPrecision(15)}:${point.y.toPrecision(15)}`
}
