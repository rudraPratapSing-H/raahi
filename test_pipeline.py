import unittest
from unittest.mock import MagicMock, patch
import json
from extractor import get_embedding_with_backoff
from build_graph import build_topological_graph

class TestOfflineDataPipeline(unittest.TestCase):
    @patch('extractor.genai.Client')
    def test_pipeline_json_structure(self, mock_client_class):
        # 1. Setup mock client and mock response
        mock_client = mock_client_class.return_value
        
        # Mock the embedding response
        mock_response = MagicMock()
        mock_embedding = MagicMock()
        
        # Create a dummy 3072-dimension float array
        dummy_vector = [0.123] * 3072
        mock_embedding.values = dummy_vector
        mock_response.embeddings = [mock_embedding]
        
        mock_client.models.embed_content.return_value = mock_response
        
        # 2. Simulate getting embeddings for 2 nodes
        node_1_embedding = get_embedding_with_backoff(mock_client, b"dummy_bytes_1")
        node_2_embedding = get_embedding_with_backoff(mock_client, b"dummy_bytes_2")
        
        self.assertEqual(len(node_1_embedding), 3072)
        
        nodes_data = [
            {
                "id": "node_1_room_101",
                "name": "Room 101",
                "descriptor_vector": node_1_embedding
            },
            {
                "id": "node_2_hallway_junction",
                "name": "Hallway Junction",
                "descriptor_vector": node_2_embedding
            }
        ]
        
        edges_data = [
            {
                "from_node": "node_1_room_101",
                "to_node": "node_2_hallway_junction",
                "audio_instruction": "Exit the room, turn left, and walk 15 steps down the corridor."
            },
            {
                "from_node": "node_2_hallway_junction",
                "to_node": "node_1_room_101",
                "audio_instruction": "Walk straight toward the end of the hall. Room 101 will be the door on your right."
            }
        ]
        
        # 3. Build graph
        graph = build_topological_graph(nodes_data, edges_data)
        
        # 4. Verify JSON output
        graph_json_str = json.dumps(graph, indent=2)
        print("\n--- Generated Graph JSON ---")
        print(graph_json_str)
        print("----------------------------\n")
        
        self.assertIn("nodes", graph)
        self.assertIn("edges", graph)
        self.assertEqual(len(graph["nodes"]), 2)
        self.assertEqual(len(graph["edges"]), 2)
        
        # Verify edge structures
        self.assertEqual(graph["edges"][0]["from_node"], "node_1_room_101")
        self.assertEqual(graph["edges"][0]["to_node"], "node_2_hallway_junction")
        self.assertEqual(graph["edges"][0]["audio_instruction"], "Exit the room, turn left, and walk 15 steps down the corridor.")
        
        self.assertEqual(graph["edges"][1]["from_node"], "node_2_hallway_junction")
        self.assertEqual(graph["edges"][1]["to_node"], "node_1_room_101")

if __name__ == '__main__':
    unittest.main()
