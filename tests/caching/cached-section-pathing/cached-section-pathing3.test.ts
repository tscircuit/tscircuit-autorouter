import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryCache } from "lib/cache/InMemoryCache";
import { CachedHyperCapacityPathingSingleSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CachedHyperCapacityPathingSingleSectionSolver";
import * as problem1 from "./problem1";
import * as problem1Rotated from "./problem1-rotated";
import { CapacityPathingSingleSectionPathingSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingSingleSectionSolver";
import { getSvgFromGraphicsObject } from "graphics-debug";

describe("CachedHyperCapacityPathingSingleSectionSolver Rotational Invariance", () => {
  it("should hit the cache for a rotated version of the same problem", async () => {
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

    // --- Solver 2: Rotated Problem ---
    const problemInput2: ConstructorParameters<
      typeof CapacityPathingSingleSectionPathingSolver
    >[0] = {
      sectionNodes: problem1Rotated.sectionNodes,
      sectionEdges: problem1Rotated.sectionEdges,
      sectionConnectionTerminals: problem1Rotated.sectionConnectionTerminals,
      nodeMap: problem1Rotated.nodeMap,
      nodeEdgeMap: problem1Rotated.nodeEdgeMap,
      ...commonParams,
    };

    const solver2 = new CachedHyperCapacityPathingSingleSectionSolver({
      ...problemInput2,
      cacheProvider: cache,
    });

    // Solve the rotated problem, expecting a cache hit
    await solver2.solve();
    expect(solver2.cacheHit).toBe(true); // Second solve should be a hit

    const svg = getSvgFromGraphicsObject(await solver2.visualize(), {
      includeTextLabels: true,
    });
    expect(svg).toMatchSvgSnapshot(import.meta.path);
  });
});
