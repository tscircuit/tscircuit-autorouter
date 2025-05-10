import Flatbush from "flatbush"
import { ISpatialIndex } from "./SpatialIndex"

export class FlatbushIndex<T> implements ISpatialIndex<T> {
  private index: Flatbush
  private items: T[] = []
  private currentIndex = 0

  constructor(numItems: number) {
    if (numItems <= 0) throw new Error("Flatbush requires numItems > 0")
    this.index = new Flatbush(numItems)
  }

  insert(item: T, minX: number, minY: number, maxX: number, maxY: number) {
    if (this.currentIndex >= this.index.numItems) {
      throw new Error("Exceeded initial capacity")
    }
    this.items[this.currentIndex] = item
    this.index.add(minX, minY, maxX, maxY)
    this.currentIndex++
  }

  finish() {
    this.index.finish()
  }

  search(minX: number, minY: number, maxX: number, maxY: number): T[] {
    const ids = this.index.search(minX, minY, maxX, maxY)
    return ids.map((id) => this.items[id] || null).filter(Boolean) as T[]
  }

  clear() {
    this.items = []
    this.index = new Flatbush(0)
  }
}
