type IdentityNode = { id?: number; fields?: Record<string, IdentityNode | null>; items?: IdentityNode[] }
type CandidateRecord = { polyLines: Array<{ start: object; end: object; mPoints: object[] }>; minGaps: number[] }
let nextExternalIdentity = 2 ** 52

export class CandidateIdentityMap {
  private readonly objects = new Map<number, WeakRef<object>>()
  private readonly finalized = new FinalizationRegistry<{ id: number; reference: WeakRef<object> }>(({ id, reference }) => {
    if (this.objects.get(id) === reference) this.objects.delete(id)
  })
  private readonly identities = new WeakMap<object, number>()

  private idFor(value: object): number {
    let id = this.identities.get(value)
    if (id === undefined) {
      id = nextExternalIdentity++
      this.identities.set(value, id)
      const reference = new WeakRef(value)
      this.objects.set(id, reference)
      this.finalized.register(value, { id, reference })
    }
    return id
  }

  candidate(value: CandidateRecord): IdentityNode {
    return { id: this.idFor(value), fields: {
      polyLines: { id: this.idFor(value.polyLines), items: value.polyLines.map(line => ({ id: this.idFor(line), fields: {
        start: { id: this.idFor(line.start) }, end: { id: this.idFor(line.end) },
        mPoints: { id: this.idFor(line.mPoints), items: line.mPoints.map(point => ({ id: this.idFor(point) })) },
      } })) },
      minGaps: { id: this.idFor(value.minGaps) },
    } }
  }

  snapshot(value: Record<string, unknown>): IdentityNode {
    return { fields: {
      candidates: { items: (value.candidates as CandidateRecord[]).map(candidate => this.candidate(candidate)) },
      lastCandidate: value.lastCandidate ? this.candidate(value.lastCandidate as CandidateRecord) : null,
    } }
  }

  arguments(method: string, args: unknown[]): { args: Array<IdentityNode | null> } {
    return { args: args.map((arg, index) => index === 0 && (method === "insertCandidate" || method === "getNeighbors")
      ? this.candidate(arg as CandidateRecord) : null) }
  }

  restore(
    current: unknown,
    incoming: unknown,
    identity: IdentityNode | null | undefined,
    reconcile: (current: unknown, incoming: unknown, key?: string) => unknown,
    preserveExisting = false,
    key = "",
  ): unknown {
    if (!incoming || typeof incoming !== "object") return incoming
    if (!identity) return reconcile(current, incoming, key)
    if (identity.id !== undefined) {
      const existing = this.objects.get(identity.id)?.deref()
      if (existing && preserveExisting) return existing
      current = existing
    }
    const target = Array.isArray(incoming)
      ? (Array.isArray(current) ? current : [])
      : (current && typeof current === "object" && !Array.isArray(current) ? current : {})
    if (identity.id !== undefined) {
      if (this.objects.get(identity.id)?.deref() !== target) {
        const reference = new WeakRef(target)
        this.objects.set(identity.id, reference)
        this.finalized.register(target, { id: identity.id, reference })
      }
      this.identities.set(target, identity.id)
    }
    if (Array.isArray(incoming)) {
      const array = target as unknown[]
      incoming.forEach((entry, index): void => { array[index] = this.restore(array[index], entry, identity.items?.[index], reconcile, preserveExisting) })
      array.length = incoming.length
    } else {
      const record = target as Record<string, unknown>
      for (const name of Object.keys(record)) if (!Object.hasOwn(incoming, name)) delete record[name]
      for (const [name, entry] of Object.entries(incoming)) record[name] = this.restore(record[name], entry, identity.fields?.[name], reconcile, preserveExisting, name)
    }
    return target
  }
}
