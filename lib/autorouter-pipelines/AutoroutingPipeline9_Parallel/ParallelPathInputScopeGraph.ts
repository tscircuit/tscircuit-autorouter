import type { ParallelPathPrototypeContract } from "./createParallelPathLookaheadEligibility"

const apply = Reflect.apply
const weakMapGet = WeakMap.prototype.get
const weakMapSet = WeakMap.prototype.set
const weakSetAdd = WeakSet.prototype.add
const weakSetHas = WeakSet.prototype.has

/** A read-set index over the already admitted ORIGINAL descriptors. Traversal
 * never reads a live geometry property, so a later accessor cannot execute or
 * silently become the baseline of a queued result. */
export class ParallelPathInputScopeGraph {
  private readonly originals = new WeakMap<object, ParallelPathPrototypeContract>()

  constructor(contracts: readonly ParallelPathPrototypeContract[]) {
    for (let index = 0; index < contracts.length; index++) {
      const contract = contracts[index]!
      apply(weakMapSet, this.originals, [contract.target, contract])
    }
  }

  original(target: object): ParallelPathPrototypeContract | undefined {
    return apply(weakMapGet, this.originals, [target]) as ParallelPathPrototypeContract | undefined
  }

  /** Native completed outputs may introduce fresh wrappers/points. The caller
   * admits those through its descriptor-safe native control capture; identities
   * from the original graph ALWAYS use the original contract instead. */
  collect(
    roots: readonly unknown[],
    captureFresh: (target: object) => ParallelPathPrototypeContract | undefined,
  ): { contracts: ParallelPathPrototypeContract[]; covered: WeakSet<object> } | undefined {
    const contracts: ParallelPathPrototypeContract[] = []
    const covered = new WeakSet<object>()
    const pending: unknown[] = []
    for (let index = 0; index < roots.length; index++) pending[pending.length] = roots[index]
    while (pending.length !== 0) {
      const value = pending[pending.length - 1]
      pending.length--
      if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") continue
      if (typeof value === "number") { if (!Number.isFinite(value)) return undefined; continue }
      if (typeof value !== "object") return undefined
      if (apply(weakSetHas, covered, [value])) continue
      const contract = this.original(value) ?? captureFresh(value)
      if (!contract) return undefined
      apply(weakSetAdd, covered, [value])
      contracts[contracts.length] = contract
      for (let index = 0; index < contract.entries.length; index++) {
        const descriptor = contract.entries[index]!.descriptor
        if (!descriptor.data) return undefined
        pending[pending.length] = descriptor.value
      }
    }
    return { contracts, covered }
  }
}
