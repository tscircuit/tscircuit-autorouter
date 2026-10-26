import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

const CACHE_SLOTS = 65_536

/** A bounded workspace shared by tasks, without retaining solver instances. */
export class HighDensityRouteScoreCache {
  private readonly taskIds = new Float64Array(CACHE_SLOTS)
  private readonly xs = new Float64Array(CACHE_SLOTS)
  private readonly ys = new Float64Array(CACHE_SLOTS)
  private readonly zs = new Float64Array(CACHE_SLOTS)
  private readonly viaModes = new Uint8Array(CACHE_SLOTS)
  readonly baseHeuristics = new Float64Array(CACHE_SLOTS)
  readonly futurePenalties = new Float64Array(CACHE_SLOTS)

  /** A miss returns the complemented slot to overwrite after calculation. */
  findSlot(taskId: number, key: number, node: Node, isVia: boolean): number {
    const slot =
      (Math.imul(key, 0x9e3779b1) ^
        Math.imul(taskId, 0x85ebca6b) ^
        Number(isVia)) &
      (CACHE_SLOTS - 1)
    return this.taskIds[slot] === taskId &&
      this.xs[slot] === node.x &&
      this.ys[slot] === node.y &&
      this.zs[slot] === node.z &&
      this.viaModes[slot] === Number(isVia)
      ? slot
      : ~slot
  }

  store(
    slot: number,
    taskId: number,
    node: Node,
    isVia: boolean,
    baseHeuristic: number,
    futurePenalty: number,
  ): void {
    this.taskIds[slot] = taskId
    this.xs[slot] = node.x
    this.ys[slot] = node.y
    this.zs[slot] = node.z
    this.viaModes[slot] = Number(isVia)
    this.baseHeuristics[slot] = baseHeuristic
    this.futurePenalties[slot] = futurePenalty
  }
}
