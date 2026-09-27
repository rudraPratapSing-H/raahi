from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError, PyMongoError
import os
import json
import logging
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

def upload_graph_to_mongo(graph_json, mongo_uri, db_name="navigation", coll_name="topological_graph"):
    """
    Uploads the topological graph nodes and edges to MongoDB Atlas.
    Nodes will have a vector field 'descriptor_vector' for vector search.
    """
    if not mongo_uri:
        logger.error("MongoDB URI is not provided.")
        return False
        
    try:
        logger.info(f"Connecting to MongoDB Atlas (database: '{db_name}')...")
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        # Verify connection
        client.admin.command('ping')
        logger.info("MongoDB Atlas connection verified successfully!")
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        logger.error(f"Failed to connect to MongoDB Atlas (timeout/network): {e}")
        logger.error("Please verify your MONGO_URI and ensure your IP is whitelisted in MongoDB Atlas Network Access.")
        return False
    except PyMongoError as e:
        logger.error(f"MongoDB authentication/connection error: {e}")
        return False

    try:
        db = client[db_name]
        nodes_collection = db[f"{coll_name}_nodes"]
        edges_collection = db[f"{coll_name}_edges"]
        
        nodes = graph_json.get("nodes", [])
        edges = graph_json.get("edges", [])

        if not nodes and not edges:
            logger.warning("Graph data is empty (no nodes or edges found). Aborting upload to prevent wiping existing data.")
            return False

        # Clear existing data for fresh import
        deleted_nodes = nodes_collection.delete_many({}).deleted_count
        deleted_edges = edges_collection.delete_many({}).deleted_count
        logger.info(f"Cleared existing data ({deleted_nodes} nodes, {deleted_edges} edges removed).")
        
        if nodes:
            nodes_collection.insert_many(nodes)
            logger.info(f"Inserted {len(nodes)} nodes into {coll_name}_nodes.")
            
        if edges:
            edges_collection.insert_many(edges)
            logger.info(f"Inserted {len(edges)} edges into {coll_name}_edges.")

        logger.info("Upload to MongoDB Atlas completed successfully!")
        return True
    except PyMongoError as e:
        logger.error(f"Error during graph data upload: {e}")
        return False
    finally:
        client.close()

if __name__ == "__main__":
    load_dotenv()
    mongo_uri = os.getenv("MONGO_URI")
    
    if not mongo_uri:
        logger.error("MONGO_URI not found in environment or .env file.")
        logger.error("Please create a .env file in the repository root with: MONGO_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/?retryWrites=true&w=majority")
        exit(1)

    graph_file = os.path.join(os.path.dirname(__file__), "graph.json")
    if not os.path.exists(graph_file):
        logger.error(f"Graph file '{graph_file}' not found. Please run run_pipeline.py or build_graph.py first.")
        exit(1)

    logger.info(f"Reading graph from {graph_file}...")
    try:
        with open(graph_file, "r", encoding="utf-8") as f:
            graph_data = json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse '{graph_file}': {e}")
        exit(1)

    success = upload_graph_to_mongo(graph_data, mongo_uri)
    if not success:
        exit(1)

