import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryCache } from "lib/cache/InMemoryCache";
import { CachedHyperCapacityPathingSingleSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CachedHyperCapacityPathingSingleSectionSolver";
import {
  sectionNodes,
  sectionConnectionTerminals,
  nodeMap,
  nodeEdgeMap,
  sectionEdges,
} from "./problem1";
import { getSvgFromGraphicsObject } from "graphics-debug";
import { CapacityPathingMultiSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingMultiSectionSolver";
import { CapacityPathingSingleSectionPathingSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingSingleSectionSolver";

describe("CachedHyperCapacityPathingSingleSectionSolver Test 1", () => {
  const cache = new InMemoryCache();

  it("should correctly encode to cache space and decode back to original space", async () => {
    const problemInput: ConstructorParameters<
      typeof CapacityPathingSingleSectionPathingSolver
    >[0] = {
      sectionNodes,
      sectionEdges,
      sectionConnectionTerminals,
      centerNodeId: "nodeR3C3", // Using a central node for cache key generation
      nodeMap,
      nodeEdgeMap,
      colorMap: {
        connection_A_B: "red",
        connection_C_D: "blue",
      },
    };
    // Create solver with cache
    const solver = new CachedHyperCapacityPathingSingleSectionSolver({
      ...problemInput,
      cacheProvider: cache,
    });

    // Generate cache key and transform
    const { cacheKey, cacheToSolveSpaceTransform } =
      solver.computeCacheKeyAndTransform();

    solver.initializeSolvers();

    // Actually solve the problem, this should save to cache
    await solver.solve();
    expect(solver.cacheHit).toBe(false);

    const svg = getSvgFromGraphicsObject(await solver.visualize(), {
      includeTextLabels: true,
    });
    expect(svg).toMatchSvgSnapshot(import.meta.path);

    // Create a new solver that should use the cache
    const newSolver = new CachedHyperCapacityPathingSingleSectionSolver({
      ...problemInput,
      // centerNodeId: "nodeR4C2", // the center node shouldn't effect the cache key
      cacheProvider: cache,
    });

    // Force cache attempt (normally done in _step())
    const cacheHit = newSolver.attemptToUseCacheSync();
    expect(cacheHit).toBe(true);
  });
});
