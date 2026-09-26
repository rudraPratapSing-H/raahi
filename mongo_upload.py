from pymongo import MongoClient
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def upload_graph_to_mongo(graph_json, mongo_uri, db_name="navigation", coll_name="topological_graph"):
    """
    Uploads the topological graph nodes and edges to MongoDB Atlas.
    Nodes will have a vector field 'descriptor_vector' for vector search.
    """
    if not mongo_uri:
        logger.error("MongoDB URI is not provided.")
        return
        
    client = MongoClient(mongo_uri)
    db = client[db_name]
    nodes_collection = db[f"{coll_name}_nodes"]
    edges_collection = db[f"{coll_name}_edges"]
    
    # Clear existing data for fresh import
    nodes_collection.delete_many({})
    edges_collection.delete_many({})
    
    nodes = graph_json.get("nodes", [])
    edges = graph_json.get("edges", [])
    
    if nodes:
        nodes_collection.insert_many(nodes)
        logger.info(f"Inserted {len(nodes)} nodes into {coll_name}_nodes.")
        
    if edges:
        edges_collection.insert_many(edges)
        logger.info(f"Inserted {len(edges)} edges into {coll_name}_edges.")

if __name__ == "__main__":
    # Example usage
    pass
