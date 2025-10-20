export class DAGNode<T = string> {
	public readonly id: T;
	public readonly children: Set<T>;
	public readonly parents: Set<T>;

	constructor(id: T) {
		this.id = id;
		this.children = new Set();
		this.parents = new Set();
	}
}

export class DAG<T = string> {
	private nodes: Map<T, DAGNode<T>>;

	constructor() {
		this.nodes = new Map();
	}

	addNode(id: T): DAGNode<T> {
		if (!this.nodes.has(id)) {
			this.nodes.set(id, new DAGNode(id));
		}
		return this.nodes.get(id)!;
	}

	getNode(id: T): DAGNode<T> | undefined {
		return this.nodes.get(id);
	}

	hasNode(id: T): boolean {
		return this.nodes.has(id);
	}

	removeNode(id: T): boolean {
		const node = this.nodes.get(id);
		if (!node) return false;

		for (const childId of node.children) {
			const child = this.nodes.get(childId);
			child?.parents.delete(id);
		}

		for (const parentId of node.parents) {
			const parent = this.nodes.get(parentId);
			parent?.children.delete(id);
		}

		return this.nodes.delete(id);
	}

	addEdge(fromId: T, toId: T): void {
		const fromNode = this.addNode(fromId);
		const toNode = this.addNode(toId);

		if (this.wouldCreateCycle(fromId, toId)) {
			throw new Error(
				`Adding edge from ${fromId} to ${toId} would create a cycle`,
			);
		}

		fromNode.children.add(toId);
		toNode.parents.add(fromId);
	}

	removeEdge(fromId: T, toId: T): boolean {
		const fromNode = this.nodes.get(fromId);
		const toNode = this.nodes.get(toId);

		if (!fromNode || !toNode) return false;

		const deletedFrom = fromNode.children.delete(toId);
		const deletedTo = toNode.parents.delete(fromId);

		return deletedFrom && deletedTo;
	}

	hasEdge(fromId: T, toId: T): boolean {
		const fromNode = this.nodes.get(fromId);
		return fromNode ? fromNode.children.has(toId) : false;
	}

	private wouldCreateCycle(fromId: T, toId: T): boolean {
		if (fromId === toId) return true;

		const visited = new Set<T>();
		const stack: T[] = [toId];

		while (stack.length > 0) {
			const current = stack.pop()!;
			if (current === fromId) return true;
			if (visited.has(current)) continue;

			visited.add(current);
			const node = this.nodes.get(current);
			if (node) {
				for (const childId of node.children) {
					stack.push(childId);
				}
			}
		}

		return false;
	}

	topologicalSort(): T[] {
		const result: T[] = [];
		const visited = new Set<T>();
		const temp = new Set<T>();

		const visit = (id: T): void => {
			if (temp.has(id)) {
				throw new Error("Graph contains a cycle");
			}
			if (visited.has(id)) return;

			temp.add(id);
			const node = this.nodes.get(id);
			if (node) {
				for (const childId of node.children) {
					visit(childId);
				}
			}
			temp.delete(id);
			visited.add(id);
			result.unshift(id);
		};

		for (const id of this.nodes.keys()) {
			if (!visited.has(id)) {
				visit(id);
			}
		}

		return result;
	}

	getRoots(): T[] {
		const roots: T[] = [];
		for (const [id, node] of this.nodes) {
			if (node.parents.size === 0) {
				roots.push(id);
			}
		}
		return roots;
	}

	getLeaves(): T[] {
		const leaves: T[] = [];
		for (const [id, node] of this.nodes) {
			if (node.children.size === 0) {
				leaves.push(id);
			}
		}
		return leaves;
	}

	getDescendants(id: T): Set<T> {
		const descendants = new Set<T>();
		const stack: T[] = [id];

		while (stack.length > 0) {
			const current = stack.pop()!;
			const node = this.nodes.get(current);
			if (node) {
				for (const childId of node.children) {
					if (!descendants.has(childId)) {
						descendants.add(childId);
						stack.push(childId);
					}
				}
			}
		}

		return descendants;
	}

	getAncestors(id: T): Set<T> {
		const ancestors = new Set<T>();
		const stack: T[] = [id];

		while (stack.length > 0) {
			const current = stack.pop()!;
			const node = this.nodes.get(current);
			if (node) {
				for (const parentId of node.parents) {
					if (!ancestors.has(parentId)) {
						ancestors.add(parentId);
						stack.push(parentId);
					}
				}
			}
		}

		return ancestors;
	}

	size(): number {
		return this.nodes.size;
	}

	clear(): void {
		this.nodes.clear();
	}

	clone(): DAG<T> {
		const newDag = new DAG<T>();
		for (const [id, node] of this.nodes) {
			newDag.addNode(id);
			for (const childId of node.children) {
				newDag.addNode(childId);
			}
		}
		for (const [id, node] of this.nodes) {
			for (const childId of node.children) {
				newDag.nodes.get(id)?.children.add(childId);
				newDag.nodes.get(childId)?.parents.add(id);
			}
		}
		return newDag;
	}

	toJSON(): { nodes: T[]; edges: [T, T][] } {
		const nodes = Array.from(this.nodes.keys());
		const edges: [T, T][] = [];
		
		for (const [fromId, node] of this.nodes) {
			for (const toId of node.children) {
				edges.push([fromId, toId]);
			}
		}
		
		return { nodes, edges };
	}

	static fromJSON<T>(data: { nodes: T[]; edges: [T, T][] }): DAG<T> {
		const dag = new DAG<T>();
		
		for (const nodeId of data.nodes) {
			dag.addNode(nodeId);
		}
		
		for (const [fromId, toId] of data.edges) {
			dag.addEdge(fromId, toId);
		}
		
		return dag;
	}
}
