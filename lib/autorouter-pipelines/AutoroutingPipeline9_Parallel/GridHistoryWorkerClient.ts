import type { GridHistoryCancellation, GridHistoryDelivery, GridHistoryDispatcher,
  GridHistoryGrant, GridHistoryRequest, GridHistoryResult, GridHistoryReplayWork } from "./parallelGridHistoryTypes"

type GridCandidateDelivery = {
  promise: Promise<GridHistoryResult>
  resolve: (result: GridHistoryResult) => void
  reject: (error: Error) => void
}
type GridRequestState = {
  resolveGrant: (grant: Map<number, Promise<GridHistoryResult>>) => void
  candidates: Map<number, GridCandidateDelivery>
  admitted?: Set<number>
}

/** One monotone request namespace persists through every child in an HD batch. */
export class GridHistoryWorkerClient {
  private nextRequestId = 0
  private readonly requests = new Map<number, GridRequestState>()
  readonly replayWork: GridHistoryReplayWork = { logicalIterationsReplayed: 0,
    equivalentLogicalIterationsReplayed: 0, equivalentCandidatesAdmitted: 0 }

  constructor(
    private readonly taskId: number,
    private readonly postMessage: (request: GridHistoryRequest | GridHistoryCancellation) => void,
  ) {}

  readonly cancelUnusedHistories = (): void => {
    if (this.requests.size === 0) return
    this.postMessage({ kind: "cancelGridHistories", taskId: this.taskId })
  }

  readonly dispatch: GridHistoryDispatcher = Object.assign(async (jobs: Parameters<GridHistoryDispatcher>[0]) => {
    const requestId = ++this.nextRequestId
    const candidates = new Map<number, GridCandidateDelivery>()
    for (const job of jobs) {
      if (candidates.has(job.candidateId)) throw new Error("Grid request repeats a candidate ID")
      let resolve!: GridCandidateDelivery["resolve"]
      let reject!: GridCandidateDelivery["reject"]
      const promise = new Promise<GridHistoryResult>((res, rej) => { resolve = res; reject = rej })
      candidates.set(job.candidateId, { promise, resolve, reject })
    }
    const grant = new Promise<Map<number, Promise<GridHistoryResult>>>((resolveGrant) => {
      this.requests.set(requestId, { candidates, resolveGrant })
    })
    this.postMessage({ kind: "requestGridHistories", taskId: this.taskId, requestId, jobs })
    return grant
  }, {
    recordReplayWork: (iterations: number, equivalent: boolean): void => {
      if (!Number.isSafeInteger(iterations) || iterations < 1) throw new Error("Grid replay work must be a positive native quantum")
      this.replayWork.logicalIterationsReplayed += iterations
      if (equivalent) this.replayWork.equivalentLogicalIterationsReplayed += iterations
    },
    recordEquivalentCandidates: (count: number): void => {
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Grid equivalence count must be a nonnegative integer")
      this.replayWork.equivalentCandidatesAdmitted += count
    },
  })

  receive(message: GridHistoryGrant | GridHistoryDelivery): void {
    const request = this.requests.get(message.requestId)
    if (!request || message.taskId !== this.taskId) throw new Error("Unexpected grid history response")
    if (message.kind === "gridHistoryGrant") {
      if (request.admitted || new Set(message.admittedCandidateIds).size !== message.admittedCandidateIds.length) {
        throw new Error("Grid history grant was repeated or contains duplicate IDs")
      }
      const admitted = new Map<number, Promise<GridHistoryResult>>()
      request.admitted = new Set(message.admittedCandidateIds)
      for (const id of message.admittedCandidateIds) {
        const candidate = request.candidates.get(id)
        if (!candidate) throw new Error(`Grid grant names unknown candidate ${id}`)
        admitted.set(id, candidate.promise)
      }
      request.resolveGrant(admitted)
      if (admitted.size === 0) this.requests.delete(message.requestId)
      return
    }
    if (!request.admitted?.delete(message.candidateId)) throw new Error("Grid history delivery was not admitted")
    const candidate = request.candidates.get(message.candidateId)
    if (!candidate) throw new Error("Grid history delivery has no candidate")
    if (message.ok) candidate.resolve(message.result)
    else candidate.reject(new Error(message.error))
    if (request.admitted.size === 0) this.requests.delete(message.requestId)
  }
}
