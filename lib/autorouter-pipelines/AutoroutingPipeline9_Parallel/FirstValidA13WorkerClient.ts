import type { FirstValidA13CandidateCancellation, FirstValidA13CandidateDelivery, FirstValidA13CandidateDispatcher, FirstValidA13CandidateGrant, FirstValidA13CandidateRequest, FirstValidA13CandidateResult } from "./firstValidA13CandidateTypes"

type A13RequestState = {
  resolveGrant: (grant: { result: Promise<FirstValidA13CandidateResult> } | null) => void
  result: Promise<FirstValidA13CandidateResult>
  resolveResult: (result: FirstValidA13CandidateResult) => void
  rejectResult: (error: Error) => void
  admitted?: boolean
}

/** The optional candidate borrows the owner's pool and never creates threads. */
export class FirstValidA13WorkerClient {
  private nextRequestId = 0
  private readonly requests = new Map<number, A13RequestState>()

  constructor(
    private readonly taskId: number,
    private readonly postMessage: (request: FirstValidA13CandidateRequest | FirstValidA13CandidateCancellation) => void,
  ) {}

  readonly cancelUnusedCandidate = (): void => {
    if (this.requests.size === 0) return
    this.postMessage({
      kind: "cancelFirstValidA13Candidate",
      taskId: this.taskId,
    })
  }

  readonly dispatch: FirstValidA13CandidateDispatcher = async (job) => {
    const requestId = ++this.nextRequestId
    let resolveResult!: A13RequestState["resolveResult"]
    let rejectResult!: A13RequestState["rejectResult"]
    const result = new Promise<FirstValidA13CandidateResult>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const grant = new Promise<{ result: Promise<FirstValidA13CandidateResult> } | null>((resolveGrant) => {
      this.requests.set(requestId, { resolveGrant, result, resolveResult, rejectResult })
    })
    this.postMessage({ kind: "requestFirstValidA13Candidate", taskId: this.taskId, requestId, job })
    return grant
  }

  receive(message: FirstValidA13CandidateGrant | FirstValidA13CandidateDelivery): void {
    const request = this.requests.get(message.requestId)
    if (!request || message.taskId !== this.taskId) throw new Error("Unexpected first-valid A13 response")
    if (message.kind === "firstValidA13CandidateGrant") {
      if (request.admitted !== undefined) throw new Error("First-valid A13 grant was repeated")
      request.admitted = message.admitted
      request.resolveGrant(message.admitted ? { result: request.result } : null)
      if (!message.admitted) this.requests.delete(message.requestId)
      return
    }
    if (!request.admitted) throw new Error("First-valid A13 delivery was not admitted")
    this.requests.delete(message.requestId)
    if (message.ok) request.resolveResult(message.result)
    else request.rejectResult(new Error(message.error))
  }
}
