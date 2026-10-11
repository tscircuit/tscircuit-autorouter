/** Skip only directed hops that the native candidate heap already closed. */
export class TinyActiveIncidenceIndex {
  private readonly wordGeneration: Uint32Array
  private readonly words: Uint32Array
  private readonly firstPositionByHop: Int32Array
  private readonly nextPosition: Int32Array
  private generation = 1

  constructor(
    private readonly ports: Int32Array,
    hops: Float64Array,
    nextRegions: Int32Array,
    hopCapacity: number,
  ) {
    if (ports.length !== hops.length || ports.length !== nextRegions.length ||
      !Number.isSafeInteger(hopCapacity) || hopCapacity < 0 || hopCapacity > 0x7fffffff) {
      throw new Error("Active incidence index has invalid directed-hop dimensions")
    }
    const wordCount = Math.ceil(ports.length / 32)
    this.wordGeneration = new Uint32Array(wordCount)
    this.words = new Uint32Array(wordCount)
    this.firstPositionByHop = new Int32Array(hopCapacity).fill(-1)
    this.nextPosition = new Int32Array(ports.length).fill(-1)
    for (let position = 0; position < ports.length; position++) {
      if (nextRegions[position] === -1) continue
      const hop = hops[position]!
      if (!Number.isInteger(hop) || hop < 0 || hop >= hopCapacity) {
        throw new Error("Active incidence index contains an invalid directed hop")
      }
      this.nextPosition[position] = this.firstPositionByHop[hop]!
      this.firstPositionByHop[hop] = position
    }
  }

  get byteLength(): number {
    return this.wordGeneration.byteLength + this.words.byteLength +
      this.firstPositionByHop.byteLength + this.nextPosition.byteLength
  }

  beginSearch(): void {
    if (this.generation === 0xffffffff) {
      this.wordGeneration.fill(0)
      this.generation = 1
    } else {
      this.generation += 1
    }
  }

  getWord(word: number): number {
    return this.wordGeneration[word] === this.generation ? this.words[word]! : 0xffffffff
  }

  closeHop(hop: number, goalPort: number): void {
    // Non-incident overflow hops cannot appear in a region's CSR incidence.
    if (hop < 0) return
    if (!Number.isInteger(hop) || hop >= this.firstPositionByHop.length) {
      throw new Error("Active incidence index cannot close an invalid directed hop")
    }
    let position = this.firstPositionByHop[hop]!
    while (position !== -1) {
      // Native routing checks the goal before checking closed-hop membership.
      if (this.ports[position] !== goalPort) {
        const word = position >>> 5
        if (this.wordGeneration[word] !== this.generation) {
          this.words[word] = 0xffffffff
          this.wordGeneration[word] = this.generation
        }
        this.words[word] = this.words[word]! & ~(1 << (position & 31))
      }
      position = this.nextPosition[position]!
    }
  }
}
