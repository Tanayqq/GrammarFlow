use std::cmp::Reverse;
use std::collections::BinaryHeap;

#[derive(Debug, Clone, Copy)]
struct Edge {
    to: usize,
    weight: u64,
}

struct Graph {
    edges: Vec<Vec<Edge>>,
}

impl Graph {
    fn new(nodes: usize) -> Self {
        Self {
            edges: vec![Vec::new(); nodes],
        }
    }

    fn add_edge(&mut self, from: usize, to: usize, weight: u64) {
        assert!(from < self.edges.len() && to < self.edges.len());
        self.edges[from].push(Edge { to, weight });
    }

    fn shortest_paths(
        &self,
        start: usize,
    ) -> (Vec<Option<u64>>, Vec<Option<usize>>) {
        assert!(start < self.edges.len());

        let mut distances = vec![None; self.edges.len()];
        let mut previous = vec![None; self.edges.len()];
        let mut queue = BinaryHeap::new();

        distances[start] = Some(0);
        queue.push(Reverse((0_u64, start)));

        while let Some(Reverse((distance, node))) = queue.pop() {
            // Ignore entries superseded by a shorter route.
            if distances[node] != Some(distance) {
                continue;
            }

            for edge in &self.edges[node] {
                // Skip routes whose distance would overflow u64.
                let candidate = match distance.checked_add(edge.weight) {
                    Some(value) => value,
                    None => continue,
                };

                let improves = match distances[edge.to] {
                    Some(current) => candidate < current,
                    None => true,
                };

                if improves {
                    distances[edge.to] = Some(candidate);
                    previous[edge.to] = Some(node);
                    queue.push(Reverse((candidate, edge.to)));
                }
            }
        }

        (distances, previous)
    }
}

fn reconstruct_path(
    previous: &[Option<usize>],
    start: usize,
    target: usize,
) -> Option<Vec<usize>> {
    if start >= previous.len() || target >= previous.len() {
        return None;
    }

    let mut path = Vec::new();
    let mut current = target;

    // Bound traversal so malformed predecessor data cannot loop forever.
    for _ in 0..previous.len() {
        path.push(current);

        if current == start {
            path.reverse();
            return Some(path);
        }

        current = previous[current]?;
    }

    None
}

fn main() {
    // Node 6 is deliberately unreachable.
    let mut graph = Graph::new(7);

    let connections = [
        (0, 1, 7),
        (0, 2, 9),
        (0, 5, 14),
        (1, 2, 10),
        (1, 3, 15),
        (2, 3, 11),
        (2, 5, 2),
        (3, 4, 6),
        (4, 5, 9),
    ];

    // Add both directions to create an undirected graph.
    for &(from, to, weight) in &connections {
        graph.add_edge(from, to, weight);
        graph.add_edge(to, from, weight);
    }

    let start = 0;
    let (distances, previous) = graph.shortest_paths(start);

    assert_eq!(
        distances,
        vec![
            Some(0),
            Some(7),
            Some(9),
            Some(20),
            Some(20),
            Some(11),
            None,
        ]
    );

    for target in 0..graph.edges.len() {
        match distances[target] {
            Some(distance) => {
                let path = reconstruct_path(&previous, start, target)
                    .expect("Reachable node should have a path");

                println!(
                    "{} -> {}: distance = {}, path = {:?}",
                    start, target, distance, path
                );
            }
            None => {
                println!("{} -> {}: unreachable", start, target);
            }
        }
    }

    assert_eq!(
        reconstruct_path(&previous, start, 4),
        Some(vec![0, 2, 5, 4])
    );
    assert_eq!(reconstruct_path(&previous, start, 6), None);

    println!("All assertions passed.");
}
