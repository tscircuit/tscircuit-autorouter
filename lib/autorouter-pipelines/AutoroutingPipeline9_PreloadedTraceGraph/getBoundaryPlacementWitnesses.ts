type Interval = { start: number; end: number }
type Candidate = { id: string; position: number; fixed: boolean }
type Placement = { position: number; fixedId?: string; previous: Placement | null }

/** Maximize finite-width physical slots, keeping existing copper contacts at their coordinates. */
export const getBoundaryPlacementWitnesses = (
  candidates: Candidate[],
  freeIntervals: Interval[],
  spacing: number,
): { fixedIds: Set<string>; movablePositions: number[] } => {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error("Boundary witness spacing must be finite and positive")
  const fixed = candidates.filter((candidate) => candidate.fixed && freeIntervals.some((interval) =>
    candidate.position >= interval.start && candidate.position <= interval.end,
  )).sort((a, b) => a.position - b.position)
  const movableCount = candidates.filter((candidate) => !candidate.fixed).length
  let states = new Map<number, Placement>([[0, { position: -spacing, previous: null }]])
  for (let count = 0; count < candidates.length; count++) {
    const nextStates = new Map<number, Placement>()
    const record = (usedMovable: number, placement: Placement): void => {
      const previous = nextStates.get(usedMovable)
      if (!previous || placement.position < previous.position) nextStates.set(usedMovable, placement)
    }
    for (const [usedMovable, state] of states) {
      const minimum = state.position + spacing
      if (usedMovable < movableCount) {
        const interval = freeIntervals.find((entry) => entry.end >= minimum)
        if (interval) record(usedMovable + 1, { position: Math.max(minimum, interval.start), previous: state })
      }
      const contact = fixed.find((candidate) => candidate.position >= minimum)
      if (contact) record(usedMovable, { position: contact.position, fixedId: contact.id, previous: state })
    }
    if (nextStates.size === 0) break
    states = nextStates
  }
  const selected = [...states].sort(([a], [b]) => a - b)[0]![1]
  const fixedIds = new Set<string>()
  const movablePositions: number[] = []
  for (let placement: Placement | null = selected; placement.previous; placement = placement.previous) {
    if (placement.fixedId === undefined) movablePositions.push(placement.position)
    else fixedIds.add(placement.fixedId)
  }
  movablePositions.reverse()
  return { fixedIds, movablePositions }
}
