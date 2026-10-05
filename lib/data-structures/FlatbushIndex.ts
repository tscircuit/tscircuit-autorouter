import Flatbush from "flatbush"
import { ISpatialIndex } from "./SpatialIndex"

export class FlatbushIndex<T> implements ISpatialIndex<T> {
  private index: Flatbush
  private items: T[] = []
  private currentIndex = 0
  private capacity: number

  constructor(numItems: number) {
    this.capacity = Math.max(1, numItems)
    this.index = new Flatbush(this.capacity)
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
    this.currentIndex = 0
    this.index = new Flatbush(this.capacity)
  }
}
