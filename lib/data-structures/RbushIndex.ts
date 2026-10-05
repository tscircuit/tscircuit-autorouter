import RBush from "rbush"
import { ISpatialIndex } from "./SpatialIndex"

export class RbushIndex<T> implements ISpatialIndex<T> {
  private tree: RBush<{
    minX: number
    minY: number
    maxX: number
    maxY: number
    data: T
  }>

  constructor(maxEntries = 9) {
    this.tree = new RBush(maxEntries)
  }

  insert(item: T, minX: number, minY: number, maxX: number, maxY: number) {
    this.tree.insert({ minX, minY, maxX, maxY, data: item })
  }

  bulkLoad(
    items: Array<{
      item: T
      minX: number
      minY: number
      maxX: number
      maxY: number
    }>,
  ) {
    const nodes = items.map(({ item, minX, minY, maxX, maxY }) => ({
      minX,
      minY,
      maxX,
      maxY,
      data: item,
    }))
    this.tree.load(nodes)
  }

  search(minX: number, minY: number, maxX: number, maxY: number): T[] {
    return this.tree.search({ minX, minY, maxX, maxY }).map((n) => n.data)
  }

  clear() {
    this.tree.clear()
  }
}
