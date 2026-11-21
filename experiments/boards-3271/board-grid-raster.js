const blocked = new Uint8Array(xs.length * ys.length);
  const margin = copperRadiusMm + (input.minBoardEdgeClearance ?? 0);
  const ring = input.outline ?? [];
  for (let y = 0;y < ys.length; y++) {
    const py = ys[y];
    const crossings = [];
    const nearbyEdges = [];
    for (let i = 0;i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (a.y > py !== b.y > py)
        crossings.push((b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x);
      if (Math.max(a.y, b.y) >= py - margin && Math.min(a.y, b.y) <= py + margin)
        nearbyEdges.push([a, b]);
    }
    for (let x = 0;x < xs.length; x++) {
      const point = { x: xs[x], y: py };
      let inside = !ring.length;
      for (const crossing of crossings)
        if (point.x < crossing)
          inside = !inside;
      if (!inside || point.x < input.bounds.minX + margin - 0.000000001 || point.x > input.bounds.maxX - margin + 0.000000001 || point.y < input.bounds.minY + margin - 0.000000001 || point.y > input.bounds.maxY - margin + 0.000000001 || nearbyEdges.some(([a, b]) => Math.max(a.x, b.x) >= point.x - margin && Math.min(a.x, b.x) <= point.x + margin && !(pointSegmentDistanceToPoints(point, a, b) >= margin - 0.000000001)))
        blocked[x + y * xs.length] = 1;
    }
  }
