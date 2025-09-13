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

TODO

### Stage 2: Construct the Node Mesh

What we call the `nodeSolver` because it creates `CapacityMeshNode`s that represent where

### Stage 3-4: Simplify the Node Mesh (Strawing)

### Stage 5: Solve for Mesh edges

### Stage 6: More mesh optimization

### Stage 7: Solve for initial "High Level Planning" routes

### Stage 8: Optimize high level path plans

### Stage 9-10: Find the initial physical entry/exit points into high-level nodes

### Stage 11: Optimize the physical entry/exit points to minimize crossings

### Stage 12: Solve for physical routes within each node

### Stage 13: Combine physical paths together

### Stage 14, 16: Remove useless vias

### Stage 15, 17: Simplify Physical Paths

## Advanced Concepts

### Hyper A\* Solvers

A "Hyper Solver" is what we call a solver that "race" A\* solvers internally. This is primarily used in the High Density / Physical Trace Path solvers, because we want to run 100 different solvers, initialized with different parameters, but "give" the most iterations to the one that seems to be most successful.

For the most part, you can think of hyper solvers as self-optimizing solvers that try out a bunch of other solvers at the same time. You don't need to know the specifics of how they work, they just improve the speed of the algorithm by automatically selecting solvers that are performing well.

### DRC Checks

"Design Rule Checks" can be run from `Debug > Design Rule Checks`, they catch issues that the autorouter may have created- e.g. a trace being too close to a pad it's not supposed to be connected to

### How to Debug an Autorouter Issue

### How the cache works

### Reporting Autorouter Bugs
