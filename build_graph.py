import json

def build_topological_graph(nodes_data, edges_data):
    """
    Constructs a topological graph JSON structure.
    
    nodes_data: list of dicts with 'id', 'name', 'descriptor_vector'
    edges_data: list of dicts with 'from_node', 'to_node', 'audio_instruction'
    """
    
    graph = {
        "nodes": nodes_data,
        "edges": edges_data
    }
    return graph

def save_graph_to_json(graph, filename="graph.json"):
    with open(filename, 'w') as f:
        json.dump(graph, f, indent=2)

if __name__ == "__main__":
    # Example usage
    pass
