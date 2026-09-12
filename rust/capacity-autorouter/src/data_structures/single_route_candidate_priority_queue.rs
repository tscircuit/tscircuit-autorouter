use std::cell::OnceCell;
use std::rc::Rc;

#[derive(Clone, Debug)]
pub struct Node {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub g: f64,
    pub h: f64,
    pub f: f64,
    pub parent: Option<Rc<Node>>,
}

#[derive(Debug)]
pub(crate) struct QueuedNode {
    value: Option<Node>,
    materialized: OnceCell<Rc<Node>>,
}

impl QueuedNode {
    fn materialize(&self) -> Rc<Node> {
        self.materialized.get_or_init(|| {
            Rc::new(self.value.as_ref().expect("Queued node must have a value").clone())
        }).clone()
    }

    pub(crate) fn node(&self) -> &Node {
        if let Some(node) = self.materialized.get() {
            node
        } else {
            self.value.as_ref().expect("Queued node must have a value")
        }
    }

    pub(crate) fn into_node(self) -> Rc<Node> {
        self.materialized.into_inner().unwrap_or_else(|| {
            Rc::new(self.value.expect("Queued node must have a value"))
        })
    }
}

impl Clone for QueuedNode {
    fn clone(&self) -> Self {
        Self {
            value: None,
            materialized: OnceCell::from(self.materialize()),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct HeapEntry {
    slot: usize,
    f: f64,
}

#[derive(Clone, Debug, Default)]
pub struct SingleRouteCandidatePriorityQueue {
    heap: Vec<HeapEntry>,
    nodes: Vec<Option<QueuedNode>>,
    free_slots: Vec<usize>,
}

impl SingleRouteCandidatePriorityQueue {
    pub fn new(nodes: Vec<Rc<Node>>) -> Self {
        let mut queue = Self::default();
        for node in nodes {
            queue.enqueue(node);
        }
        queue
    }

    pub fn dequeue(&mut self) -> Option<Rc<Node>> {
        self.dequeue_pending().map(QueuedNode::into_node)
    }

    pub(crate) fn dequeue_pending(&mut self) -> Option<QueuedNode> {
        if self.heap.is_empty() {
            return None;
        }
        let item = self.heap[0];
        self.heap[0] = self.heap[self.heap.len() - 1];
        self.heap.pop();
        self.heapify_down();
        let queued = self.nodes[item.slot].take().expect("Heap entry must have a node");
        self.free_slots.push(item.slot);
        Some(queued)
    }

    pub fn peek(&self) -> Option<Rc<Node>> {
        let item = self.heap.first()?;
        Some(self.nodes[item.slot].as_ref()
            .expect("Heap entry must have a node")
            .materialize())
    }

    pub fn enqueue(&mut self, item: Rc<Node>) {
        let f = item.f;
        self.enqueue_node(QueuedNode {
            value: None,
            materialized: OnceCell::from(item),
        }, f);
    }

    pub fn enqueue_owned(&mut self, item: Node) {
        let f = item.f;
        self.enqueue_node(QueuedNode {
            value: Some(item),
            materialized: OnceCell::new(),
        }, f);
    }

    fn enqueue_node(&mut self, node: QueuedNode, f: f64) {
        let slot = if let Some(slot) = self.free_slots.pop() {
            self.nodes[slot] = Some(node);
            slot
        } else {
            self.nodes.push(Some(node));
            self.nodes.len() - 1
        };
        self.heap.push(HeapEntry { slot, f });
        self.heapify_up();
    }

    pub fn heapify_up(&mut self) {
        let mut index = self.heap.len() - 1;
        let item = self.heap[index];
        while index > 0 {
            let parent_index = (index - 1) / 2;
            let parent = self.heap[parent_index];
            if parent.f <= item.f {
                break;
            }
            self.heap[index] = parent;
            index = parent_index;
        }
        self.heap[index] = item;
    }

    pub fn heapify_down(&mut self) {
        let mut index = 0;
        let heap_length = self.heap.len();
        let Some(item) = self.heap.first().copied() else { return; };
        loop {
            let left_child_index = 2 * index + 1;
            if left_child_index >= heap_length {
                break;
            }
            let right_child_index = left_child_index + 1;
            let mut smaller_child_index = left_child_index;
            if right_child_index < heap_length
                && self.heap[right_child_index].f < self.heap[left_child_index].f
            {
                smaller_child_index = right_child_index;
            }
            if item.f < self.heap[smaller_child_index].f {
                break;
            }
            self.heap[index] = self.heap[smaller_child_index];
            index = smaller_child_index;
        }
        self.heap[index] = item;
    }

    pub fn get_top_n(&self, n: usize) -> Vec<Rc<Node>> {
        let mut candidates = self.heap.clone();
        candidates.sort_by(|a, b| (a.f - b.f).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        candidates.truncate(n);
        candidates.into_iter().map(|entry| {
            self.nodes[entry.slot].as_ref().expect("Heap entry must have a node").materialize()
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{Node, SingleRouteCandidatePriorityQueue};
    use std::rc::Rc;

    #[test]
    fn owned_queue_preserves_ties_identity_and_recycled_slots() {
        let parent = Rc::new(Node {
            x: -1.0, y: 0.0, z: 0.0, g: 0.0, h: 0.0, f: 0.0, parent: None,
        });
        let mut queue = SingleRouteCandidatePriorityQueue::default();
        for (index, f) in [3.0, 1.0, 1.0, 2.0, 1.0].into_iter().enumerate() {
            queue.enqueue_owned(Node {
                x: index as f64, y: 0.0, z: 0.0, g: f, h: 0.0, f,
                parent: Some(parent.clone()),
            });
        }
        let first = queue.peek().expect("first candidate");
        let ranked = queue.get_top_n(5);
        assert!(Rc::ptr_eq(&first, &ranked[0]));
        assert_eq!(ranked.iter().map(|node| node.x).collect::<Vec<_>>(), vec![1.0, 4.0, 2.0, 3.0, 0.0]);
        let mut copied = queue.clone();
        for expected in ranked {
            let actual = queue.dequeue().expect("candidate");
            assert!(Rc::ptr_eq(&actual, &expected));
            assert!(Rc::ptr_eq(&actual, &copied.dequeue().expect("copied candidate")));
            assert!(Rc::ptr_eq(actual.parent.as_ref().unwrap(), &parent));
        }
        assert!(queue.dequeue().is_none());
        let capacity = queue.nodes.len();
        queue.enqueue_owned(Node {
            x: 9.0, y: 0.0, z: 0.0, g: 0.0, h: 0.0, f: 0.0, parent: Some(parent),
        });
        assert_eq!(queue.nodes.len(), capacity);
        let recycled = queue.peek().expect("recycled slot candidate");
        assert_eq!(recycled.x, 9.0);
        assert!(Rc::ptr_eq(&recycled, &queue.dequeue().unwrap()));
        assert_eq!(first.x, 1.0);
        for index in 0..2 {
            queue.enqueue_owned(Node {
                x: index as f64, y: 0.0, z: 0.0, g: 0.0, h: 0.0, f: index as f64,
                parent: None,
            });
        }
        let rejected = queue.dequeue_pending().expect("unobserved candidate");
        assert_eq!(rejected.node().x, 0.0);
        assert!(rejected.materialized.get().is_none());
        drop(rejected);
        let observed = queue.peek().expect("observed candidate");
        let pending = queue.dequeue_pending().expect("observed pending candidate");
        assert_eq!(pending.node().x, 1.0);
        assert!(Rc::ptr_eq(&observed, &pending.into_node()));
    }
}
