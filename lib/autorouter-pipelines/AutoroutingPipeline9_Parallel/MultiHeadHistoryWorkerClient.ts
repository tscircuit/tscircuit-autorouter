import type { MultiHeadHistoryCancellation, MultiHeadHistoryDelivery, MultiHeadHistoryDispatcher, MultiHeadHistoryGrant, MultiHeadHistoryRequest, MultiHeadHistoryResult } from "./parallelMultiHeadHistoryTypes"

type CandidateDelivery = { promise: Promise<MultiHeadHistoryResult>; resolve: (result: MultiHeadHistoryResult) => void; reject: (error: Error) => void }
type HistoryRequestState = {
  resolveGrant: (grant: Map<number, Promise<MultiHeadHistoryResult>>) => void
  candidates: Map<number, CandidateDelivery>
  admitted?: Set<number>
}

export class MultiHeadHistoryWorkerClient {
  private nextRequestId = 0
  private readonly requests = new Map<number, HistoryRequestState>()
  private readonly taskId: number
  private readonly postMessage: (request: MultiHeadHistoryRequest | MultiHeadHistoryCancellation) => void

  constructor(
    taskId: number,
    postMessage: (request: MultiHeadHistoryRequest | MultiHeadHistoryCancellation) => void,
  ) {
    this.taskId = taskId
    this.postMessage = postMessage
  }

  readonly cancelUnusedHistories = (): void => {
    if (this.requests.size === 0) return
    this.postMessage({
      kind: "cancelMultiHeadHistories",
      taskId: this.taskId,
    })
  }

  readonly dispatch: MultiHeadHistoryDispatcher = async (jobs) => {
    const requestId = ++this.nextRequestId
    const candidates = new Map<number, CandidateDelivery>()
    for (const job of jobs) {
      let resolve!: CandidateDelivery["resolve"]
      let reject!: CandidateDelivery["reject"]
      const promise = new Promise<MultiHeadHistoryResult>((res, rej) => { resolve = res; reject = rej })
      candidates.set(job.candidateId, { promise, resolve, reject })
    }
    const grant = new Promise<Map<number, Promise<MultiHeadHistoryResult>>>((resolveGrant) => {
      this.requests.set(requestId, { candidates, resolveGrant })
    })
    this.postMessage({ kind: "requestMultiHeadHistories", taskId: this.taskId, requestId, jobs })
    return grant
  }

  receive(message: MultiHeadHistoryGrant | MultiHeadHistoryDelivery): void {
    const request = this.requests.get(message.requestId)
    if (!request || message.taskId !== this.taskId) throw new Error("Unexpected multi-head history response")
    if (message.kind === "multiHeadHistoryGrant") {
      if (request.admitted) throw new Error("Multi-head history grant was repeated")
      const admitted = new Map<number, Promise<MultiHeadHistoryResult>>()
      request.admitted = new Set(message.admittedCandidateIds)
      for (const id of message.admittedCandidateIds) {
        const candidate = request.candidates.get(id)
        if (!candidate) throw new Error(`Multi-head grant names unknown candidate ${id}`)
        admitted.set(id, candidate.promise)
      }
      request.resolveGrant(admitted)
      if (admitted.size === 0) this.requests.delete(message.requestId)
      return
    }
    if (!request.admitted?.delete(message.candidateId)) throw new Error("Multi-head history delivery was not admitted")
    const candidate = request.candidates.get(message.candidateId)
    if (!candidate) throw new Error("Multi-head history delivery has no candidate")
    if (message.ok) candidate.resolve(message.result)
    else candidate.reject(new Error(message.error))
    if (request.admitted.size === 0) this.requests.delete(message.requestId)
  }
}
