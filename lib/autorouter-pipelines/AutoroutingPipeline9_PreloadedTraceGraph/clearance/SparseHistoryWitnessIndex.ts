/** Candidate index for an explicitly retained bank of sorted via histories. */
export class SparseHistoryWitnessIndex<T extends { sites: readonly number[] }> {
  private readonly buckets = new Map<number, Set<T>>()

  add(witness: T): void {
    if (witness.sites.length < 2) throw new Error("Sparse witness index requires a multi-site history")
    const first = witness.sites[0]!
    const bucket = this.buckets.get(first) ?? new Set<T>()
    bucket.add(witness)
    this.buckets.set(first, bucket)
  }

  remove(witness: T): void {
    const first = witness.sites[0]!
    const bucket = this.buckets.get(first)
    if (!bucket?.delete(witness)) throw new Error("Sparse witness index removed an unretained witness")
    if (bucket.size === 0) this.buckets.delete(first)
  }

  get(firstSite: number): ReadonlySet<T> | undefined {
    return this.buckets.get(firstSite)
  }
}
