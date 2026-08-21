export interface CacheProvider {
  // IndexedDb, localstorage, in-memory, or any non-network cache that you can call synchronously
  isSyncCache: boolean;

  cacheHits: number;
  cacheMisses: number;
  cacheHitsByPrefix: Record<string, number>;
  cacheMissesByPrefix: Record<string, number>;

  getCachedSolutionSync(cacheKey: string): any;
  getCachedSolution(cacheKey: string): Promise<any>;

  setCachedSolutionSync(cacheKey: string, cachedSolution: any): void;
  setCachedSolution(cacheKey: string, cachedSolution: any): Promise<void>;

  getAllCacheKeys(): string[];

  clearCache(): void;
}

export interface CachableSolver<
  CacheToSolveSpaceTransform = any,
  CachedSolution = any,
> {
  cacheHit: boolean;
  hasAttemptedToUseCache: boolean;
  cacheProvider: CacheProvider | null;

  cacheKey?: string;
  cacheToSolveSpaceTransform?: CacheToSolveSpaceTransform;

  /**
   * Processes solver inputs and constructs a cacheKey and a cacheToSolveSpaceTransform
   * which gives the necessary information to convert a cached solution into a valid
   * solution for this solver. For example, the cacheKey may be translation-invariant, so
   * any cachedSolution would not be translated properly for this solver. The cacheToSolveSpaceTransform
   * tells you how to convert from the cache space (translation-invarant) to the correct
   * space for this solver. It can also contain information about how cache ids map to
   * ids for the solver
   **/
  computeCacheKeyAndTransform(): {
    cacheKey: string;
    cacheToSolveSpaceTransform: CacheToSolveSpaceTransform;
  };

  applyCachedSolution(cachedSolution: CachedSolution): void;

  attemptToUseCacheSync(): boolean;

  saveToCacheSync(): void;
}
