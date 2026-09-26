import os
import logging
from pymongo import MongoClient
from google import genai
from extractor import get_embedding_with_backoff
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def find_current_node(image_path):
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    mongo_uri = os.getenv("MONGO_URI")
    
    if not api_key or not mongo_uri:
        logger.error("API Key or Mongo URI missing from environment variables.")
        return None

    if not os.path.exists(image_path):
        logger.error(f"Image {image_path} not found.")
        return None

    # 1. Extract feature vector from the query image
    logger.info(f"Extracting features from {image_path}...")
    client = genai.Client(api_key=api_key)
    
    mime_type = "image/png" if image_path.lower().endswith('.png') else "image/jpeg"
    
    with open(image_path, 'rb') as f:
        image_bytes = f.read()
        
    try:
        query_vector = get_embedding_with_backoff(client, image_bytes, mime_type)
        logger.info(f"Successfully extracted {len(query_vector)}-dimensional vector.")
    except Exception as e:
        logger.error(f"Failed to extract features: {e}")
        return None

    # 2. Search MongoDB using Vector Search
    logger.info("Connecting to MongoDB for vector search...")
    db_client = MongoClient(mongo_uri)
    db = db_client["navigation"]
    nodes_collection = db["topological_graph_nodes"]

    pipeline = [
        {
            "$vectorSearch": {
                "index": "vector_index", 
                "path": "descriptor_vector",
                "queryVector": query_vector,
                "numCandidates": 100,
                "limit": 3
            }
        },
        {
            "$project": {
                "_id": 0,
                "id": 1,
                "name": 1,
                "score": {"$meta": "vectorSearchScore"}
            }
        }
    ]

    try:
        results = list(nodes_collection.aggregate(pipeline))
        
        if not results:
            logger.warning("No matches found in the database.")
            return None

        # 3. Output the best match
        best_match = results[0]
        print("\n--- Localization Results ---")
        for i, match in enumerate(results):
            name = match.get('name') or match.get('id')
            score = match.get('score', 0)
            print(f"#{i+1}: Node '{name}' (Score: {score:.4f})")
        
        confidence_threshold = 0.85
        if best_match.get('score', 0) > confidence_threshold:
            print(f"\n=> Confidence is high. You are currently at: {best_match.get('name') or best_match.get('id')}")
            return best_match
        else:
            print(f"\n=> Best match score ({best_match.get('score', 0):.4f}) is below confidence threshold ({confidence_threshold}).")
            return None
            
    except Exception as e:
        logger.error(f"MongoDB vector search failed: {e}")
        return None

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        image_to_test = sys.argv[1]
        find_current_node(image_to_test)
    else:
        print("Usage: python localizer.py <path_to_image>")
