// Pure native computeG arithmetic from tiny-hypergraph commit
// 474f5222e799b54348da41d96a0da0694509fab8. No routing or memo mutations.
// Copyright (c) 2026 tscircuit. MIT: ../tiny-hypergraph-fork/LICENSE.
typedef unsigned int u32;
typedef int i32;
typedef unsigned char u8;

// Output flags: bit0 means original computeG populated its geometry scratch;
// bit1 means original computeG reached computeRegionCostForRegion/memo.get.
void score_region(const i32 *first_region, const i32 *second_region,
  const i32 *angle1, const i32 *angle2, const i32 *z, const double *penalties,
  const i32 *neighbors, const double *distances, const double *maximum_costs,
  const i32 *existing_net, const i32 *existing_lesser,
  const i32 *existing_greater, const i32 *existing_layers,
  double *g_out, double *cost_out, i32 *same_out, i32 *cross_out,
  i32 *changes_out, i32 *lesser_out, i32 *greater_out, i32 *layers_out,
  u8 *flags_out, u32 count, u32 existing_length,
  i32 source, i32 region, i32 net, i32 available_layers,
  double candidate_g, double congestion, double scale,
  double width, double height, double pad, double density,
  double existing_same, double existing_cross, double existing_changes,
  double existing_count, double existing_cost) {
  i32 source_angle = first_region[source] == region || second_region[source] != region
    ? angle1[source] : angle2[source];
  i32 source_z = z[source];
  double area = width * height;
  double diameter = pad + 0.15;
  double via_square = diameter * diameter;
  u32 mask = (u32)available_layers;
  i32 single_layer = available_layers > 0 && (mask & (mask - 1U)) == 0;
  u32 layer_count = mask == 0 ? 2 : 0;
  for (u32 bits = mask; bits != 0; bits >>= 1) layer_count += bits & 1U;
  for (u32 row = 0; row < count; ++row) {
    i32 port = neighbors[row];
    double distance_cost = distances[row] * scale;
    double penalty = penalties ? penalties[port] : 0;
    double lower = ((candidate_g + congestion) + penalty) + distance_cost;
    g_out[row] = __builtin_inf();
    cost_out[row] = 0;
    same_out[row] = 0;
    cross_out[row] = 0;
    changes_out[row] = 0;
    lesser_out[row] = 0;
    greater_out[row] = 0;
    layers_out[row] = 0;
    flags_out[row] = 0;
    if (lower > maximum_costs[row] + 1e-9) continue;
    i32 changes = source_z != z[port] ? 1 : 0;
    u32 same = 0;
    u32 cross = 0;
    if (existing_count > 0) {
      i32 destination_angle = first_region[port] == region || second_region[port] != region
        ? angle1[port] : angle2[port];
      i32 lesser = source_angle < destination_angle ? source_angle : destination_angle;
      i32 greater = source_angle < destination_angle ? destination_angle : source_angle;
      u32 layers = (1U << ((u32)source_z & 31U)) | (1U << ((u32)z[port] & 31U));
      flags_out[row] = 1;
      lesser_out[row] = lesser;
      greater_out[row] = greater;
      layers_out[row] = (i32)layers;
      for (u32 index = 0; index < existing_length; ++index) {
        if (net == existing_net[index]) continue;
        i32 lesser_inside = lesser < existing_lesser[index] && existing_lesser[index] < greater;
        i32 greater_inside = lesser < existing_greater[index] && existing_greater[index] < greater;
        if (lesser_inside == greater_inside) continue;
        if ((layers & (u32)existing_layers[index]) != 0) ++same;
        else ++cross;
      }
    }
    same_out[row] = (i32)same;
    cross_out[row] = (i32)cross;
    changes_out[row] = changes;
    if (same > 0 && single_layer) continue;
    double total_same = existing_same + (double)same;
    double total_cross = existing_cross + (double)cross;
    double total_changes = existing_changes + (double)changes;
    double trace_count = existing_count + 1;
    double estimated_vias = (total_same * 2 + total_cross * 1) + total_changes * 1;
    double trace_multiplier = 1 + trace_count / 5;
    double impossible_cost = single_layer ? total_same * 10 : 0;
    double per_layer = trace_count / (double)layer_count;
    double density_cost = (((density * (per_layer * per_layer)) * 0.010000000000000002) / area);
    double cost = ((estimated_vias * via_square * trace_multiplier) / area + impossible_cost) + density_cost;
    cost_out[row] = cost;
    flags_out[row] |= 2;
    double delta = cost - existing_cost;
    g_out[row] = (((candidate_g + delta) + congestion) + penalty) + distance_cost;
  }
}

// Tuples-only production primitive. The original JS visitor commits scratch,
// memo LRU and all G arithmetic after its live best/first-goal checks.
void score_region_intersections(const i32 *first_region, const i32 *second_region,
  const i32 *angle1, const i32 *angle2, const i32 *z,
  const i32 *ports, const i32 *positions,
  const i32 *existing_net, const i32 *existing_lesser,
  const i32 *existing_greater, const i32 *existing_layers,
  i32 *same_out, i32 *cross_out, i32 *changes_out, i32 *lesser_out,
  i32 *greater_out, i32 *layers_out, u8 *flags_out,
  u32 count, u32 existing_length, i32 source, i32 region, i32 net,
  i32 goal, double existing_count) {
  i32 source_angle = first_region[source] == region || second_region[source] != region
    ? angle1[source] : angle2[source];
  i32 source_z = z[source];
  for (u32 row = 0; row < count; ++row) {
    i32 port = ports[positions[row]];
    same_out[row] = 0; cross_out[row] = 0;
    changes_out[row] = 0; lesser_out[row] = 0; greater_out[row] = 0;
    layers_out[row] = 0; flags_out[row] = 0;
    if (port == goal) continue;
    changes_out[row] = source_z != z[port] ? 1 : 0;
    if (!(existing_count > 0)) continue;
    i32 destination_angle = first_region[port] == region || second_region[port] != region
      ? angle1[port] : angle2[port];
    i32 lesser = source_angle < destination_angle ? source_angle : destination_angle;
    i32 greater = source_angle < destination_angle ? destination_angle : source_angle;
    u32 layers = (1U << ((u32)source_z & 31U)) | (1U << ((u32)z[port] & 31U));
    flags_out[row] = 1; lesser_out[row] = lesser; greater_out[row] = greater;
    layers_out[row] = (i32)layers;
    u32 same = 0, cross = 0;
    for (u32 index = 0; index < existing_length; ++index) {
      if (net == existing_net[index]) continue;
      i32 lesser_inside = lesser < existing_lesser[index] && existing_lesser[index] < greater;
      i32 greater_inside = lesser < existing_greater[index] && existing_greater[index] < greater;
      if (lesser_inside == greater_inside) continue;
      if ((layers & (u32)existing_layers[index]) != 0) ++same;
      else ++cross;
    }
    same_out[row] = (i32)same; cross_out[row] = (i32)cross;
  }
}
