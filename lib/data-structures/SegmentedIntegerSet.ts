const maximumIntegerCount = 0x8000_0000
const integersPerSegment = 4096
const segmentByteLength = integersPerSegment / 8

type IntegerSegmentIndex = number

export class SegmentedIntegerSet implements Iterable<number> {
  private readonly integerCount: number
  private readonly segmentsByIndex = new Map<
    IntegerSegmentIndex,
    Uint8Array
  >()
  private readonly integersInInsertionOrder: number[] = []

  constructor(integerCount: number) {
    if (
      !Number.isSafeInteger(integerCount) ||
      integerCount < 0 ||
      integerCount > maximumIntegerCount
    ) {
      throw new RangeError(
        `SegmentedIntegerSet integerCount must be an integer from 0 to ${maximumIntegerCount}, received ${integerCount}`,
      )
    }
    this.integerCount = integerCount
  }

  get size(): number {
    return this.integersInInsertionOrder.length
  }

  has(integer: number): boolean {
    if ((integer >>> 0) !== integer || integer >= this.integerCount) return false
    const segmentIndex = Math.floor(
      integer / integersPerSegment,
    ) as IntegerSegmentIndex
    const integerWithinSegment = integer % integersPerSegment
    const segment = this.segmentsByIndex.get(segmentIndex)
    if (!segment) return false
    const byteIndex = integerWithinSegment >>> 3
    const bitMask = 1 << (integerWithinSegment & 7)
    return (segment[byteIndex]! & bitMask) !== 0
  }

  add(integer: number): this {
    if ((integer >>> 0) !== integer || integer >= this.integerCount) {
      throw new RangeError(
        `SegmentedIntegerSet integer must be from 0 to ${this.integerCount - 1}, received ${integer}`,
      )
    }
    const segmentIndex = Math.floor(
      integer / integersPerSegment,
    ) as IntegerSegmentIndex
    const integerWithinSegment = integer % integersPerSegment
    let segment = this.segmentsByIndex.get(segmentIndex)
    if (!segment) {
      segment = new Uint8Array(segmentByteLength)
      this.segmentsByIndex.set(segmentIndex, segment)
    }
    const byteIndex = integerWithinSegment >>> 3
    const bitMask = 1 << (integerWithinSegment & 7)
    if ((segment[byteIndex]! & bitMask) !== 0) return this
    segment[byteIndex] = segment[byteIndex]! | bitMask
    this.integersInInsertionOrder.push(integer)
    return this
  }

  clear(): void {
    this.segmentsByIndex.clear()
    this.integersInInsertionOrder.length = 0
  }

  *[Symbol.iterator](): IterableIterator<number> {
    yield* this.integersInInsertionOrder
  }
}
