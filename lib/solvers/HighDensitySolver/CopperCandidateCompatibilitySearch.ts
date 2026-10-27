import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

export type CopperRouteCandidate = {
  id: number
  task: number
  route: HighDensityIntraNodeRoute
}

type Params = {
  domains: readonly (readonly CopperRouteCandidate[])[]
  maxAttempts: number
  charge: (name: string, count?: number) => void
  conflict: (left: CopperRouteCandidate, right: CopperRouteCandidate) => boolean
}

/**
 * A bounded simultaneous choice of physical routes, independent of the order
 * that generated them. Exhausting these finite domains proves nothing about
 * routes outside the archive; the caller can keep generating new candidates.
 */
export class CopperCandidateCompatibilitySearch {
  status: "searching" | "found" | "exhausted" | "limited" = "searching"
  solution?: CopperRouteCandidate[]
  attempts = 0
  rejected = 0
  private depth = 0
  private readonly domains: CopperRouteCandidate[][]
  private readonly order: number[]
  private readonly selected: Array<CopperRouteCandidate | undefined>
  private readonly next: number[]
  private readonly params: Params

  constructor(params: Params) {
    this.params = params
    if (!params.domains.length || !Number.isSafeInteger(params.maxAttempts) || params.maxAttempts < 1)
      throw new Error("Invalid copper candidate search allowance")
    params.charge("priorityCandidateDomainCopies", params.domains.length * 3)
    this.domains = params.domains.map((domain, task) => {
      if (!domain.length || domain.some((candidate) => candidate.task !== task))
        throw new Error("Incomplete or misidentified copper candidate domain")
      params.charge("priorityCandidateDomainCopies", domain.length * 3)
      return [...domain].reverse()
    })
    this.order = this.domains.map((_, task) => task).sort((a, b) => {
      params.charge("priorityCandidateDomainComparisons")
      return this.domains[a].length - this.domains[b].length || a - b
    })
    this.selected = this.domains.map(() => undefined)
    this.next = this.domains.map(() => 0)
  }

  step(): void {
    if (this.status !== "searching")
      throw new Error("Completed copper candidate search stepped again")
    this.params.charge("priorityCandidateSearchDispatches")
    const task = this.order[this.depth]
    const domain = this.domains[task]
    if (this.next[this.depth] >= domain.length) {
      this.selected[task] = undefined
      this.next[this.depth] = 0
      if (this.depth === 0) {
        this.status = "exhausted"
      } else {
        this.depth--
        this.selected[this.order[this.depth]] = undefined
      }
      return
    }
    if (this.attempts >= this.params.maxAttempts) {
      this.status = "limited"
      return
    }
    const candidate = domain[this.next[this.depth]++]
    this.attempts++
    this.params.charge("priorityCandidateSelectionAttempts")
    for (let index = 0; index < this.depth; index++) {
      this.params.charge("priorityCandidateSelectedPairVisits")
      const previous = this.selected[this.order[index]]
      if (!previous) throw new Error("Missing selected copper candidate")
      if (this.params.conflict(previous, candidate)) {
        this.rejected++
        return
      }
    }
    this.selected[task] = candidate
    this.depth++
    if (this.depth === this.order.length) {
      this.params.charge("priorityCandidateSolutionCopies", this.selected.length)
      this.solution = this.selected.map((choice) => {
        if (!choice) throw new Error("Incomplete compatible copper assignment")
        return choice
      })
      this.status = "found"
    }
  }
}
