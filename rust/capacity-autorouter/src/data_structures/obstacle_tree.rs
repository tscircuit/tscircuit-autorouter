type ObstacleQuery = Rc<dyn Fn(&str, &[f64]) -> Result<Vec<ObstacleRef>, String>>;

use crate::bindings::trace_simplification::types::{Bounds, ObstacleRef};
use indexmap::{IndexMap, IndexSet};
use std::rc::Rc;

#[derive(Clone, Debug)]
pub struct NativeObstacleTree {
    pub buckets: IndexMap<(i64, i64), Vec<(ObstacleRef, usize)>>,
    pub cell_size: f64,
    pub obstacles: Vec<ObstacleRef>,
}

impl NativeObstacleTree {
    pub fn new(obstacles: Vec<ObstacleRef>) -> Self {
        let mut tree = Self {
            buckets: IndexMap::new(),
            cell_size: 0.4,
            obstacles,
        };
        for (i, obstacle_ref) in tree.obstacles.iter().enumerate() {
            let obstacle = obstacle_ref.borrow();
            let node_min_x = obstacle.center.x - obstacle.width / 2.0;
            let node_min_y = obstacle.center.y - obstacle.height / 2.0;
            let node_max_x = obstacle.center.x + obstacle.width / 2.0;
            let node_max_y = obstacle.center.y + obstacle.height / 2.0;
            let mut x = node_min_x;
            while x <= node_max_x {
                let mut y = node_min_y;
                while y <= node_max_y {
                    let key = tree.get_bucket_key(x, y);
                    tree.buckets
                        .entry(key)
                        .or_default()
                        .push((obstacle_ref.clone(), i));
                    y += tree.cell_size;
                }
                x += tree.cell_size;
            }
        }
        tree
    }

    pub fn get_bucket_key(&self, x: f64, y: f64) -> (i64, i64) {
        (
            (x / self.cell_size).floor() as i64,
            (y / self.cell_size).floor() as i64,
        )
    }

    pub fn get_nodes_in_area(
        &self,
        center_x: f64,
        center_y: f64,
        width: f64,
        height: f64,
    ) -> Vec<ObstacleRef> {
        let mut obstacles = Vec::new();
        let mut already_added_obstacles = IndexSet::new();
        let min_x = center_x - width / 2.0;
        let min_y = center_y - height / 2.0;
        let max_x = center_x + width / 2.0;
        let max_y = center_y + height / 2.0;
        let mut x = min_x;
        while x <= max_x {
            let mut y = min_y;
            while y <= max_y {
                if let Some(bucket) = self.buckets.get(&self.get_bucket_key(x, y)) {
                    for (obstacle, index) in bucket {
                        if already_added_obstacles.insert(*index) {
                            obstacles.push(obstacle.clone());
                        }
                    }
                }
                y += self.cell_size;
            }
            x += self.cell_size;
        }
        obstacles
    }
}

#[derive(Clone)]
pub struct ObstacleSpatialHashIndex {
    pub identity: u64,
    pub storage: Vec<ObstacleRef>,
    pub native: NativeObstacleTree,
    pub imported: Option<ImportedObstacleIndex>,
    pub host_query: Option<ObstacleQuery>,
}

impl ObstacleSpatialHashIndex {
    pub fn new(obstacles: Vec<ObstacleRef>) -> Self {
        Self {
            identity: crate::bindings::trace_simplification::types::next_identity(),
            native: NativeObstacleTree::new(obstacles.clone()),
            storage: obstacles,
            imported: None,
            host_query: None,
        }
    }

    pub fn new_flatbush(obstacles: Vec<ObstacleRef>) -> Self {
        let imported = if obstacles.is_empty() {
            ImportedObstacleIndex::Rbush(RbushNode {
                bounds: Bounds {
                    min_x: f64::INFINITY,
                    min_y: f64::INFINITY,
                    max_x: f64::NEG_INFINITY,
                    max_y: f64::NEG_INFINITY,
                },
                leaf: true,
                height: Some(1),
                children: Vec::new(),
                data: None,
            })
        } else {
            let mut index =
                crate::solvers::high_density_solver::flatbush::Flatbush::new(obstacles.len());
            for obstacle in &obstacles {
                let obstacle = obstacle.borrow();
                index.add(
                    obstacle.center.x - obstacle.width / 2.0,
                    obstacle.center.y - obstacle.height / 2.0,
                    obstacle.center.x + obstacle.width / 2.0,
                    obstacle.center.y + obstacle.height / 2.0,
                );
            }
            index.finish();
            ImportedObstacleIndex::BuiltFlatbush {
                index,
                items: obstacles.clone(),
            }
        };
        Self {
            identity: crate::bindings::trace_simplification::types::next_identity(),
            native: NativeObstacleTree::new(Vec::new()),
            storage: obstacles,
            imported: Some(imported),
            host_query: None,
        }
    }

    pub fn insert(&mut self, obstacle: ObstacleRef) {
        self.storage.push(obstacle);
    }

    pub fn search(&self, bounds: &Bounds) -> Result<Vec<ObstacleRef>, String> {
        if let Some(query) = &self.host_query {
            return query(
                "search",
                &[bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y],
            );
        }
        if let Some(index) = &self.imported {
            return Ok(index.search(bounds));
        }
        Ok(self.native.get_nodes_in_area(
            (bounds.min_x + bounds.max_x) / 2.0,
            (bounds.min_y + bounds.max_y) / 2.0,
            bounds.max_x - bounds.min_x,
            bounds.max_y - bounds.min_y,
        ))
    }

    pub fn search_area(
        &self,
        center_x: f64,
        center_y: f64,
        width: f64,
        height: f64,
    ) -> Result<Vec<ObstacleRef>, String> {
        if let Some(query) = &self.host_query {
            return query("searchArea", &[center_x, center_y, width, height]);
        }
        self.search(&Bounds {
            min_x: center_x - width / 2.0,
            min_y: center_y - height / 2.0,
            max_x: center_x + width / 2.0,
            max_y: center_y + height / 2.0,
        })
    }
}

#[derive(Clone, Debug)]
pub struct RbushNode {
    pub bounds: Bounds,
    pub leaf: bool,
    pub height: Option<usize>,
    pub children: Vec<RbushNode>,
    pub data: Option<ObstacleRef>,
}

#[derive(Clone, Debug)]
pub enum ImportedObstacleIndex {
    Rbush(RbushNode),
    BuiltFlatbush {
        index: crate::solvers::high_density_solver::flatbush::Flatbush,
        items: Vec<ObstacleRef>,
    },
    Flatbush {
        boxes: Vec<f64>,
        indices: Vec<usize>,
        level_bounds: Vec<usize>,
        node_size: usize,
        num_items: usize,
        items: Vec<ObstacleRef>,
    },
}

impl ImportedObstacleIndex {
    pub fn search(&self, bounds: &Bounds) -> Vec<ObstacleRef> {
        let mut result = Vec::new();
        match self {
            Self::BuiltFlatbush { index, items } => {
                for id in index.search(bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y) {
                    result.push(items[id].clone());
                }
            }
            Self::Rbush(root) => {
                let intersects = |node: &RbushNode| {
                    node.bounds.min_x <= bounds.max_x
                        && node.bounds.min_y <= bounds.max_y
                        && node.bounds.max_x >= bounds.min_x
                        && node.bounds.max_y >= bounds.min_y
                };
                if !intersects(root) {
                    return result;
                }
                let mut queue = vec![root];
                while let Some(node) = queue.pop() {
                    for child in &node.children {
                        if !intersects(child) {
                            continue;
                        }
                        if node.leaf {
                            result.push(child.data.as_ref().expect("Rbush leaf data").clone());
                        } else if bounds.min_x <= child.bounds.min_x
                            && bounds.min_y <= child.bounds.min_y
                            && child.bounds.max_x <= bounds.max_x
                            && child.bounds.max_y <= bounds.max_y
                        {
                            let mut all = vec![child];
                            while let Some(node) = all.pop() {
                                if node.leaf {
                                    result.extend(node.children.iter().map(|child| {
                                        child.data.as_ref().expect("Rbush leaf data").clone()
                                    }));
                                } else {
                                    all.extend(node.children.iter());
                                }
                            }
                        } else {
                            queue.push(child);
                        }
                    }
                }
            }
            Self::Flatbush {
                boxes,
                indices,
                level_bounds,
                node_size,
                num_items,
                items,
            } => {
                let num_items4 = num_items * 4;
                let mut queue = vec![(boxes.len() - 4, level_bounds.len() - 1, false)];
                while let Some((node_index, level, contained)) = queue.pop() {
                    let end = (node_index + node_size * 4).min(level_bounds[level]);
                    if contained {
                        let mut pos = node_index;
                        for _ in (1..=level).rev() {
                            pos = indices[pos >> 2];
                        }
                        let leaf_end = (pos + (end - node_index) * node_size.pow(level as u32))
                            .min(num_items4);
                        for pos in (pos..leaf_end).step_by(4) {
                            if let Some(item) = items.get(indices[pos >> 2]) {
                                result.push(item.clone());
                            }
                        }
                    } else {
                        for pos in (node_index..end).step_by(4) {
                            let (x0, y0, x1, y1) =
                                (boxes[pos], boxes[pos + 1], boxes[pos + 2], boxes[pos + 3]);
                            if bounds.max_x < x0
                                || bounds.max_y < y0
                                || bounds.min_x > x1
                                || bounds.min_y > y1
                            {
                                continue;
                            }
                            let index = indices[pos >> 2];
                            if node_index >= num_items4 {
                                let contained = bounds.min_x <= x0
                                    && bounds.min_y <= y0
                                    && bounds.max_x >= x1
                                    && bounds.max_y >= y1;
                                queue.push((index, level - 1, contained));
                            } else if let Some(item) = items.get(index) {
                                result.push(item.clone());
                            }
                        }
                    }
                }
            }
        }
        result
    }
}

impl std::fmt::Debug for ObstacleSpatialHashIndex {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ObstacleSpatialHashIndex")
            .field("storage", &self.storage)
            .field("native", &self.native)
            .field("imported", &self.imported)
            .field("has_host_query", &self.host_query.is_some())
            .finish()
    }
}
