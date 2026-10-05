/**
 * A Disjoint Set Union (DSU) or Union-Find data structure.
 * It tracks a collection of disjoint sets and can efficiently merge them.
 */
export class DSU {
  private parent: Record<string, string> = {}

  /**
   * Creates a new DSU instance.
   * Each ID is initially in its own set.
   */
  constructor(ids: string[]) {
    for (const id of ids) {
      this.parent[id] = id
    }
  }

  /**
   * Finds the representative of the set containing the given ID.
   * Uses path compression.
   */
  find(id: string): string {
    if (this.parent[id] === id) {
      return id
    }
    return (this.parent[id] = this.find(this.parent[id]))
  }

  /**
   * Merges the sets containing the two given IDs.
   */
  union(id1: string, id2: string) {
    const root1 = this.find(id1)
    const root2 = this.find(id2)
    if (root1 !== root2) {
      this.parent[root2] = root1
    }
  }

  /**
   * Gets all IDs in the same set as the given ID.
   */
  getGroup(id: string): string[] {
    const root = this.find(id)
    const group: string[] = []
    for (const memberId in this.parent) {
      if (this.find(memberId) === root) {
        group.push(memberId)
      }
    }
    return group
  }
}
