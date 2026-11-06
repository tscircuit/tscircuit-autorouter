# Pipeline9 connection minimum trace width

`SimpleRouteConnection.minTraceWidth` is an optional, explicit hard minimum for
new copper routed by local or networked Pipeline9. Values are positive finite
numbers in millimeters. It is separate from `nominalTraceWidth`, which remains a
preference and can still be reduced when no hard minimum was supplied.

```ts
{
  minTraceWidth: 0.1, // Board-wide minimum
  connections: [{
    name: "POWER",
    minTraceWidth: 0.4, // Hard minimum for this connection
    nominalTraceWidth: 0.6, // Preferred width, when clearance permits
    pointsToConnect: [
      { x: -5, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }],
  // ...bounds, obstacles, and layerCount
}
```

The effective minimum is the larger of the board and connection minima. A
nominal preference below that minimum is raised to the minimum. Omitted nominal
widths are supported.

When connected directives merge, their largest explicit minimum applies to the
whole merged connection. Every branch created by point-pair/MST splitting
inherits it. Thus the result is independent of which merged directive supplied
the minimum. This contract does not express different hard widths on individual
branches of the same merged net.

Hard minima include terminal escapes: Pipeline9 does not implicitly taper below
them at small pads. Existing nominal-only terminal neckdowns remain unchanged.
Previously supplied fixed copper stays fixed and is not retroactively enlarged.

Planning checks port and transition clearance using each connection's minimum.
Detailed routing reserves the largest required width in each shared routing
node; unrelated nodes retain their normal width. Networked node requests carry
that reserved width. Width selection checks its minimum candidate instead of
falling back to the board width. The final pipeline checks emitted wire widths
again after repair, length matching, and expansion.

The opt-in search uses native graph routing instead of prepared/section
optimizers that do not enforce connection-specific eligibility. Minimum-width
routes are also held fixed during optional trace simplification, whose path
optimizer currently hardcodes its obstacle margin. Nominal routes can still
simplify around their exact copper. These choices can increase routing work and
are conservative in nodes shared by connections of different widths; they do
not guarantee a solution for every physically routable board.

If the routing graph cannot accommodate the minimum, the solve fails with the
connection name and requested minimum. It does not return thinner successful
output. Nominal-only requests retain the existing usable-output/warning policy.

This is an SRJ/Pipeline9 contract. A caller such as core must explicitly forward
the hard minimum to use it; merely supplying `nominalTraceWidth` does not opt in.
