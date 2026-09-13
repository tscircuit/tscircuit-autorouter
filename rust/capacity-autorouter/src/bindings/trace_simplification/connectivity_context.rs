use crate::bindings::trace_simplification::types::{ConnectivityMap, ObstacleRef, RouteRef};
use indexmap::IndexMap;
use rustc_hash::FxBuildHasher;
use std::rc::Rc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResolvedId {
    raw: usize,
    net: Option<usize>,
}

impl ResolvedId {
    pub fn is_connected_to(self, other: Self) -> bool {
        if self.raw == other.raw {
            return true;
        }
        let (Some(first), Some(second)) = (self.net, other.net) else {
            return false;
        };
        // The dependency's second-net-to-first-id comparison is asymmetric.
        first == second || second == self.raw || second == self.raw
    }
}

#[derive(Clone, Copy)]
pub struct ResolvedRoute {
    pub connection: ResolvedId,
    pub root: Option<ResolvedId>,
}

impl ResolvedRoute {
    pub fn is_connected_to_any(self, ids: &[ResolvedId]) -> bool {
        ids.iter().any(|id| {
            self.connection.is_connected_to(*id)
                || self.root.is_some_and(|root| root.is_connected_to(*id))
        })
    }
}

struct PreparedObstacle {
    source: Rc<Vec<String>>,
    ids: Rc<[ResolvedId]>,
}

pub struct ConnectivityContext {
    source: Rc<ConnectivityMap>,
    revision: usize,
    names: IndexMap<String, usize, FxBuildHasher>,
    resolved: Vec<Option<ResolvedId>>,
    obstacles: IndexMap<u64, PreparedObstacle, FxBuildHasher>,
}

impl ConnectivityContext {
    pub fn new(source: Rc<ConnectivityMap>) -> Self {
        Self {
            revision: source.revision(),
            source,
            names: IndexMap::with_hasher(FxBuildHasher),
            resolved: Vec::new(),
            obstacles: IndexMap::with_hasher(FxBuildHasher),
        }
    }

    pub fn refresh(&mut self, source: &Rc<ConnectivityMap>) {
        let revision = source.revision();
        if Rc::ptr_eq(&self.source, source) && self.revision == revision {
            return;
        }
        self.source = source.clone();
        self.revision = revision;
        self.names.clear();
        self.resolved.clear();
        self.obstacles.clear();
    }

    fn intern(&mut self, name: &str) -> usize {
        if let Some(id) = self.names.get(name) {
            return *id;
        }
        let id = self.names.len();
        self.names.insert(name.to_owned(), id);
        self.resolved.push(None);
        id
    }

    pub fn resolve(&mut self, name: &str) -> ResolvedId {
        let raw = self.intern(name);
        if let Some(id) = self.resolved[raw] {
            return id;
        }
        let net = self
            .source
            .id_to_net_map
            .get(name)
            .filter(|net| !net.is_empty())
            .cloned();
        let net = net.as_deref().map(|net| self.intern(net));
        let id = ResolvedId { raw, net };
        self.resolved[raw] = Some(id);
        id
    }

    pub fn resolve_route(&mut self, route: &RouteRef) -> ResolvedRoute {
        let route = route.borrow();
        ResolvedRoute {
            connection: self.resolve(&route.connection_name),
            root: route
                .root_connection_name
                .as_deref()
                .map(|root| self.resolve(root)),
        }
    }

    pub fn resolve_obstacle(&mut self, obstacle: &ObstacleRef) -> Rc<[ResolvedId]> {
        let obstacle = obstacle.borrow();
        if let Some(cached) = self.obstacles.get(&obstacle.identity)
            && Rc::ptr_eq(&cached.source, &obstacle.connected_to)
        {
            return cached.ids.clone();
        }
        let ids: Rc<[ResolvedId]> = obstacle
            .connected_to
            .iter()
            .map(|name| self.resolve(name))
            .collect::<Vec<_>>()
            .into();
        self.obstacles.insert(
            obstacle.identity,
            PreparedObstacle {
                source: obstacle.connected_to.clone(),
                ids: ids.clone(),
            },
        );
        ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolved_predicate_preserves_asymmetry_empty_ids_and_context_replacement() {
        let source: ConnectivityMap = serde_json::from_value(serde_json::json!({
            "netMap": {},
            "idToNetMap": {"a":"net", "b":"a", "net":"other", "empty":""}
        }))
        .unwrap();
        let source = Rc::new(source);
        let mut context = ConnectivityContext::new(source.clone());
        for first in ["a", "b", "net", "empty", "", "missing"] {
            for second in ["a", "b", "net", "empty", "", "missing"] {
                let a = context.resolve(first);
                let b = context.resolve(second);
                assert_eq!(
                    a.is_connected_to(b),
                    source.are_ids_connected(first, second),
                    "{first} -> {second}"
                );
            }
        }
        assert!(context.resolve("a").is_connected_to(context.resolve("b")));
        let updated = ConnectivityMap::new(IndexMap::new());
        source.replace_from(&updated);
        context.refresh(&source);
        assert!(!context.resolve("a").is_connected_to(context.resolve("b")));
        let replacement = Rc::new(ConnectivityMap::new(IndexMap::new()));
        context.refresh(&replacement);
        assert!(!context.resolve("a").is_connected_to(context.resolve("b")));
        let obstacle =
            crate::bindings::trace_simplification::types::obstacle_from_value(&serde_json::json!({
                "center":{"x":0,"y":0}, "width":1, "height":1, "connectedTo":["a"]
            }));
        let first = context.resolve_obstacle(&obstacle);
        assert!(context.resolve("a").is_connected_to(first[0]));
        assert!(Rc::ptr_eq(&first, &context.resolve_obstacle(&obstacle)));
        Rc::make_mut(&mut obstacle.borrow_mut().connected_to)[0] = "b".into();
        let updated = context.resolve_obstacle(&obstacle);
        assert!(!context.resolve("a").is_connected_to(updated[0]));
        assert!(context.resolve("b").is_connected_to(updated[0]));
    }
}
