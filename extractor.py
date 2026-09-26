import os
from google import genai
from google.genai import types
from tenacity import retry, wait_exponential, stop_after_attempt
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Basic retry on rate limit / exceptions
@retry(
    wait=wait_exponential(multiplier=1, min=2, max=30),
    stop=stop_after_attempt(5),
    reraise=True
)
def get_embedding_with_backoff(client, image_bytes, mime_type="image/jpeg"):
    # Convert bytes to a Part object for Gemini Multimodal API
    # Since we are using gemini-embedding-2 which is multimodal, we can embed images directly.
    part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
    
    response = client.models.embed_content(
        model='gemini-embedding-2',
        contents=part,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT"
        )
    )
    if not response.embeddings or not response.embeddings[0].values:
         raise ValueError("No embeddings returned")
    return response.embeddings[0].values

def extract_features_from_directory(directory_path, api_key):
    client = genai.Client(api_key=api_key)
    
    embeddings_dict = {}
    
    if not os.path.exists(directory_path):
        logger.error(f"Directory {directory_path} not found.")
        return embeddings_dict

    for filename in os.listdir(directory_path):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            filepath = os.path.join(directory_path, filename)
            logger.info(f"Processing {filename}...")
            
            # Determine mime type
            mime_type = "image/png" if filename.lower().endswith('.png') else "image/jpeg"
            
            with open(filepath, 'rb') as f:
                image_bytes = f.read()
            
            try:
                embedding = get_embedding_with_backoff(client, image_bytes, mime_type)
                # Node id could just be the filename without extension for simplicity
                node_id = os.path.splitext(filename)[0]
                embeddings_dict[node_id] = embedding
                logger.info(f"Successfully extracted {len(embedding)} dimensions for {filename}")
            except Exception as e:
                logger.error(f"Failed to extract features for {filename}: {e}")
                
    return embeddings_dict
