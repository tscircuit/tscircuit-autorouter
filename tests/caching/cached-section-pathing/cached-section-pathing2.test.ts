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

it("should correctly encode to cache space the same if loaded from cache", async () => {
  const cache = new InMemoryCache();
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
  const solver1 = new CachedHyperCapacityPathingSingleSectionSolver({
    ...problemInput,
    cacheProvider: cache,
  });

  solver1.computeCacheKeyAndTransform();

  solver1.initializeSolvers();

  // Actually solve the problem, this should save to cache
  await solver1.solve();

  // Create a new solver that should use the cache
  const solver2 = new CachedHyperCapacityPathingSingleSectionSolver({
    ...problemInput,
    // centerNodeId: "nodeR4C2", // the center node shouldn't effect the cache key
    cacheProvider: cache,
  });

  // Force cache attempt (normally done in _step())
  await solver2.solve();
  expect(solver2.cacheHit).toBe(true);

  const svg = getSvgFromGraphicsObject(await solver2.visualize(), {
    includeTextLabels: true,
  });
  expect(svg).toMatchSvgSnapshot(import.meta.path);
});
