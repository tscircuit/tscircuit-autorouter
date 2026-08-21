export interface ISpatialIndex<T> {
  insert(item: T, minX: number, minY: number, maxX: number, maxY: number): void;
  bulkLoad?(
    items: Array<{
      item: T;
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }>,
  ): void;
  finish?(): void;
  search(minX: number, minY: number, maxX: number, maxY: number): T[];
  clear(): void;
}
