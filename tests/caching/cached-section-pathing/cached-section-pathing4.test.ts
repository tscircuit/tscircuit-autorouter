import { describe, expect, it } from "bun:test";
import { InMemoryCache } from "lib/cache/InMemoryCache";
import { CachedHyperCapacityPathingSingleSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CachedHyperCapacityPathingSingleSectionSolver";
import * as problem1 from "./problem1";
import * as problem1Flipped from "./problem1-flip-connections";
import { CapacityPathingSingleSectionPathingSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingSingleSectionSolver";
import { getSvgFromGraphicsObject } from "graphics-debug";

describe("CachedHyperCapacityPathingSingleSectionSolver Connection Flip Invariance", () => {
  it("should hit the cache even when connection start/end nodes are flipped", async () => {
    const cache = new InMemoryCache();

    const commonParams = {
      centerNodeId: "nodeR3C3", // Using a central node for cache key generation
      colorMap: {
        connection_A_B: "red",
        connection_C_D: "blue",
      },
    };

    // --- Solver 1: Original Problem ---
    const problemInput1: ConstructorParameters<
      typeof CapacityPathingSingleSectionPathingSolver
    >[0] = {
      sectionNodes: problem1.sectionNodes,
      sectionEdges: problem1.sectionEdges,
      sectionConnectionTerminals: problem1.sectionConnectionTerminals,
      nodeMap: problem1.nodeMap,
      nodeEdgeMap: problem1.nodeEdgeMap,
      ...commonParams,
    };

    const solver1 = new CachedHyperCapacityPathingSingleSectionSolver({
      ...problemInput1,
      cacheProvider: cache,
    });

    // Solve the original problem to populate the cache
    await solver1.solve();
    expect(solver1.cacheHit).toBe(false); // First solve should be a miss

    // --- Solver 2: Flipped Connection Problem ---
    const problemInput2: ConstructorParameters<
      typeof CapacityPathingSingleSectionPathingSolver
    >[0] = {
      sectionNodes: problem1Flipped.sectionNodes,
      sectionEdges: problem1Flipped.sectionEdges,
      sectionConnectionTerminals: problem1Flipped.sectionConnectionTerminals,
      nodeMap: problem1Flipped.nodeMap,
      nodeEdgeMap: problem1Flipped.nodeEdgeMap,
      ...commonParams,
    };

    const solver2 = new CachedHyperCapacityPathingSingleSectionSolver({
      ...problemInput2,
      cacheProvider: cache,
    });

    // Solve the flipped problem, expecting a cache hit
    await solver2.solve();
    expect(solver2.cacheHit).toBe(true); // Second solve should be a hit

    // Optional: Visualize and snapshot the result from the cached run
    const svg = getSvgFromGraphicsObject(await solver2.visualize(), {
      includeTextLabels: true,
    });
    // Note: The snapshot should look identical to cached-section-pathing1.snap.svg
    // because the underlying pathing solution is the same, just derived from cache.
    // The start/end labels in the SVG will reflect the *flipped* input though.
    expect(svg).toMatchSvgSnapshot(import.meta.path);
  });
});
