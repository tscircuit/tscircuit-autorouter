# Trace clearance to non-plated holes

Pipeline 7 (the default autorouter) and Pipeline 9 accept
`minTraceToHoleClearance` in SimpleRouteJson. The value is a finite, non-negative
distance in millimeters, measured from the trace copper edge to the hole edge.

```ts
const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -8, maxX: 8, minY: -5, maxY: 5 },
  connections: [{
    name: "signal",
    pointsToConnect: [
      { x: -5, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }],
  minTraceToHoleClearance: 0.2,
  obstacles: [
    {
      type: "rect",
      shape: "circle",
      isHole: true,
      obstacleId: "switch_mount_hole",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layers: ["top", "bottom"],
      connectedTo: [],
    },
  ],
}
```

SRJ producers must mark non-plated holes with `isHole: true` and supply the
physical hole dimensions. An empty `connectedTo` array alone does not identify
a hole: unrelated keepouts can also have no electrical connections. Plated pads
continue to use the existing pad clearance rules. For a non-circular hole, omit
`shape` and use a rectangular envelope, with `ccwRotationDegrees` when needed.

The router creates internal clearance envelopes before routing and retains them
through simplification, repair, and power-trace expansion. Existing routing
margins still apply, so the measured clearance can exceed the requested minimum.
The returned SRJ preserves the physical hole dimensions. Final trace geometry,
including retained preloaded traces, is checked against those original dimensions
before either pipeline reports success. This rule checks trace copper, not via
annuli or copper pours.

Omitting the setting preserves existing routing behavior. Core integration must
forward the board prop into this SRJ field **and** identify hole obstacles. To
replace old routes, submit an unrouted SRJ; replaying saved routes does not make
them satisfy a new clearance constraint.
