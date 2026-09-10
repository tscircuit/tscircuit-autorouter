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

#[derive(Clone, Debug, Default)]
pub struct SingleRouteCandidatePriorityQueue {
    heap: Vec<Rc<Node>>,
}

impl SingleRouteCandidatePriorityQueue {
    pub fn new(nodes: Vec<Rc<Node>>) -> Self {
        let mut queue = Self { heap: Vec::new() };
        for node in nodes {
            queue.enqueue(node);
        }
        queue
    }

    pub fn dequeue(&mut self) -> Option<Rc<Node>> {
        if self.heap.is_empty() {
            return None;
        }
        let item = self.heap[0].clone();
        self.heap[0] = self.heap[self.heap.len() - 1].clone();
        self.heap.pop();
        self.heapify_down();
        Some(item)
    }

    pub fn peek(&self) -> Option<Rc<Node>> {
        if self.heap.is_empty() {
            return None;
        }
        Some(self.heap[0].clone())
    }

    pub fn enqueue(&mut self, item: Rc<Node>) {
        self.heap.push(item);
        self.heapify_up();
    }

    pub fn heapify_up(&mut self) {
        let mut index = self.heap.len() - 1;
        let item = self.heap[index].clone();
        while index > 0 {
            let parent_index = (index - 1) / 2;
            let parent = self.heap[parent_index].clone();
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
        let Some(item) = self.heap.first().cloned() else { return; };
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
            self.heap[index] = self.heap[smaller_child_index].clone();
            index = smaller_child_index;
        }
        self.heap[index] = item;
    }

    pub fn get_top_n(&self, n: usize) -> Vec<Rc<Node>> {
        let mut candidates = self.heap.clone();
        candidates.sort_by(|a, b| (a.f - b.f).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        candidates.truncate(n);
        candidates
    }
}
