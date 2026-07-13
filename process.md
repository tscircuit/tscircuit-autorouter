# srj18 sample 14 routing investigation

- Dataset and target: `srj18`, sample 14, Pipeline 7 tiny-hypergraph port-point pathing.
- Execution location: local repository only.
- Baseline: selective reripping applies zero traversal cost to cramped ports. On
  this sample it repeatedly rerips routes through a component-local crossing and
  spends most of its time in relaxed blocker searches instead of converging.
- Success criterion: sample 14 completes its port-point-pathing phase without
  the selective rerip timeout, while retaining the existing sample 6 selective
  rerip behavior.
