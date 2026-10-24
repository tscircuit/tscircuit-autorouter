export type OwnerPairCutWork = {
  pairDomainRebuilds: number; pairAllocatedWords: number; pairInitializedWords: number
  pairReplayedCuts: number; pairCutTerms: number; pairTermOwnerReads: number; pairDomainWordReads: number
  pairActiveTests: number; pairChoiceWordReads: number; pairStorageLimitHits: number
}

/** Exact cardinality-two master. All state belongs to one immutable query. */
export class OwnerPairCutDomain {
  private ownerCount = -1
  private appliedCuts = 0
  private pairs = new Uint32Array(0)
  private limited = false
  /** Four MiB for the retained triangular domain; exceeding it is UNKNOWN. */
  readonly maximumWords = 1048576

  constructor(private charge: (field: keyof OwnerPairCutWork, units?: number) => boolean) {}

  get storage(): { words: number; bytes: number; limited: boolean } {
    // This is retained pair-domain storage, not process RSS or all query memory.
    // Temporary per-cut singleton flags and Set entries are separately bounded
    // by owner count/cut terms and charged during their original visits.
    // Earlier domain arrays may remain pending GC after a counted rebuild.
    return { words: this.pairs.length, bytes: this.pairs.byteLength, limited: this.limited }
  }

  private ownerPair(index: number): [number, number] {
    let second = Math.floor((1 + Math.sqrt(1 + 8 * index)) / 2)
    while ((second * (second - 1)) / 2 > index) second--
    while (((second + 1) * second) / 2 <= index) second++
    const first = index - (second * (second - 1)) / 2
    if (!Number.isSafeInteger(first) || first < 0 || first >= second || second >= this.ownerCount) {
      throw new Error("Owner pair triangular index is outside its exact domain")
    }
    return [first, second]
  }

  private reset(ownerCount: number): boolean {
    if (!Number.isSafeInteger(ownerCount) || ownerCount < 0) throw new Error("Invalid owner-pair universe")
    const pairCount = ownerCount * (ownerCount - 1) / 2, words = Math.ceil(pairCount / 32)
    if (!Number.isSafeInteger(pairCount) || !Number.isSafeInteger(words) || words > this.maximumWords) {
      this.charge("pairStorageLimitHits")
      this.limited = true
      return false
    }
    if (!this.charge("pairDomainRebuilds") || !this.charge("pairAllocatedWords", words) || !this.charge("pairInitializedWords", words)) return false
    this.ownerCount = ownerCount
    this.appliedCuts = 0
    this.pairs = new Uint32Array(words)
    this.pairs.fill(0xffffffff)
    if (pairCount % 32 !== 0) this.pairs[words - 1] = 2 ** (pairCount % 32) - 1
    return true
  }

  private apply(cut: readonly (readonly number[])[]): boolean {
    if (!this.charge("pairReplayedCuts")) return false
    const singletons = new Set<number>(), exactPairs = new Set<number>()
    for (const term of cut) {
      if (!this.charge("pairCutTerms")) return false
      if (term.length === 0) throw new Error("A failed owner cut cannot contain an empty term")
      let previous = -1
      for (const owner of term) {
        if (!this.charge("pairTermOwnerReads")) return false
        if (!Number.isSafeInteger(owner) || owner <= previous || owner >= this.ownerCount) {
          throw new Error("Owner-pair term IDs must be unique ascending members of its universe")
        }
        previous = owner
      }
      // Cardinality-two assignments cannot enable conjunctions of three owners.
      // Every learned term has unique, ascending, per-query owner IDs.
      if (term.length === 1) singletons.add(term[0]!)
      if (term.length === 2) exactPairs.add(term[1]! * (term[1]! - 1) / 2 + term[0]!)
    }
    for (let word = 0; word < this.pairs.length; word++) {
      if (!this.charge("pairDomainWordReads")) return false
      let bits = this.pairs[word]!
      while (bits !== 0) {
        if (!this.charge("pairActiveTests")) return false
        const bit = bits & -bits, offset = 31 - Math.clz32(bit), index = word * 32 + offset
        const [first, second] = this.ownerPair(index)
        if (!singletons.has(first) && !singletons.has(second) && !exactPairs.has(index)) {
          this.pairs[word] = (this.pairs[word]! & ~bit) >>> 0
        }
        bits = (bits & (bits - 1)) >>> 0
      }
    }
    return true
  }

  choose(ownerCount: number, cuts: readonly (readonly (readonly number[])[])[]): [number, number] | undefined {
    if (this.limited) return undefined
    // A newly observed owner changes the triangular universe. Reinitialize ALL
    // pairs and replay EVERY old cut before returning anything; zero-filled new
    // words or only applying the latest cut would give an unsound late owner.
    if (ownerCount !== this.ownerCount && !this.reset(ownerCount)) { this.limited = true; return undefined }
    if (cuts.length < this.appliedCuts) throw new Error("Owner-pair cuts must be append-only")
    while (this.appliedCuts < cuts.length) {
      if (!this.apply(cuts[this.appliedCuts]!)) { this.limited = true; return undefined }
      this.appliedCuts++
    }
    for (let word = 0; word < this.pairs.length; word++) {
      if (!this.charge("pairChoiceWordReads")) { this.limited = true; return undefined }
      const bits = this.pairs[word]!
      if (bits !== 0) return this.ownerPair(word * 32 + 31 - Math.clz32(bits & -bits))
    }
    return undefined
  }
}
