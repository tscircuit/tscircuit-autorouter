# How the tscircuit autorouter works (visually)

It took me nearly a year to build the first version of the tscircuit autorouter,
capable of drawing the small copper wires on[keyboards](#) and [led matrices](#).
Over the past 6 months, people have been using the autorouter but this has resulted in a lot of [bug reports](https://github.com/tscircuit/tscircuit-autorouter/issues)
but the autorouter codebase still has very few contributors. This blog post is
an attempt to explain each stage of the autorouter to hopefully make it easier
to contribute. It's also just a great introduction to building a topological
autorouter, since this autorouter basically represents our fourth attempt!

Before we get started, you should know we have some strong opionions:

- Autorouters should be very very fast (execute in less than 500ms)
- The secret to making a fast autorouter is a big cache, not a fast language
- Successive approximation (making guesses and refining them) is better than trying
  to solve problems optimially the first try
- Autorouters should be built as a pipeline where each stage refines data
- The fastest autorouters must be topological (they must operate on optimized graph structures rather than in physical space)

This blog post will focus on what each stage does, because when you're debugging
an issue with the autorouter, you'll almost always want to find a "stage to blame"

## Overview

Before we get into the nitty-gritty details, you should understand the high-level plan:

1. Set up our data as a "high-level route planning graph"
2. Find a paths through the high level graph
3. Turn the high level paths into physical trace paths
4. Optimize the physical trace paths

### Stage 1: Create a minimum spanning tree

[Net to Point Pairs Video](https://share.cleanshot.com/GYFNck1D)

### Stage 2: Construct the Node Mesh

What we call the `nodeSolver` because it creates `CapacityMeshNode`s that represent where

[Node Mesh Part 1](https://share.cleanshot.com/Tw8XJ0Qy)
[Node Mesh Part 2](https://share.cleanshot.com/p0HNy5Bv)

### Stage 3-4: Simplify the Node Mesh (Strawing)

[Simplify Node Mesh, Straw Solving](https://share.cleanshot.com/TX7XsBqk)

### Stage 5: Solve for Mesh edges

[Solving for Mesh Edges](https://share.cleanshot.com/q7QbnKxJ)

### Stage 6: More mesh optimization (removing dead ends)

[Dead End Solver](https://share.cleanshot.com/LTgVVcF6)

### Stage 7: Solve for initial "High Level Planning" routes

[Initial Node Pathing Solver Part 1 (overview)](https://share.cleanshot.com/SB7rcsw4)
[Initial Node Pathing Solver Part 2 (code walkthrough)](https://share.cleanshot.com/zQGHS33R)

### Stage 8: Optimize high level path plans

[Optimizing High Level Path Plans](https://share.cleanshot.com/zQGHS33R)

### Stage 9-10: Find the initial physical entry/exit points into high-level nodes

[Finding the exact entry/exit points for traces in capacity nodes](https://share.cleanshot.com/ZnZlNyWd)

### Stage 11: Unraveling: Optimize the physical entry/exit points to minimize crossings

[Unravel Autorouting Phase](https://share.cleanshot.com/HqM4K9PF)

### Stage 12: Solve for physical routes within each node

[The High Density Phase](https://share.cleanshot.com/V0GLLcz9)

This is by far the most complicated stage, and it's also "autorouting" in the
truest most traditional definition. In this stage, we're figuring out how to
take those physical entry/exit points around our square node, and connect them
to eachother without them touching!

There are so many different ways to do this and they all have advantages and
disadvantages, so instead of choosing we decided to use a Hyper Solver, this
special solver runs many sub-solvers in parallel to find any working solution.

> Remember, we don't need the best paths, we just need ANY working paths. We'll
> optimize them in a future stage.

Each sub-solver uses a totally different technique, so let's go over each one:

#### Stage 12.1 The Traditional Grid Solver with Hyper Parameters

Coming soon!

#### Stage 12.2 HD Polyline Solver i.e. Place and Force Solver

Coming soon!

### Stage 13: Combine physical paths together (Stitching)

[The Stitch Phase](https://share.cleanshot.com/MbMDNNvc)

### Stage 14, 16: Remove useless vias

[Remove Useless Vias Stage](https://share.cleanshot.com/ckgNBSZK)

### Stage 15, 17: Simplify Physical Paths

[Simplify Physical Paths Stage](https://share.cleanshot.com/qPDZ7Bz4)

## Advanced Concepts

### What is a Solver?

### Hyper A\* Solvers

A "Hyper Solver" is what we call a solver that "race" A\* solvers internally. This is primarily used in the High Density / Physical Trace Path solvers, because we want to run 100 different solvers, initialized with different parameters, but "give" the most iterations to the one that seems to be most successful.

For the most part, you can think of hyper solvers as self-optimizing solvers that try out a bunch of other solvers at the same time. You don't need to know the specifics of how they work, they just improve the speed of the algorithm by automatically selecting solvers that are performing well.

### DRC Checks

"Design Rule Checks" can be run from `Debug > Design Rule Checks`, they catch issues that the autorouter may have created- e.g. a trace being too close to a pad it's not supposed to be connected to

### How to Debug an Autorouter Issue

[Report an Autorouter Bug](https://docs.tscircuit.com/contributing/report-autorouter-bugs)

### How the cache works

### Reporting Autorouter Bugs

### Spatial Indexing
