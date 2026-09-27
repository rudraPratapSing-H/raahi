import os
from dotenv import load_dotenv
from extractor import extract_features_from_directory
from build_graph import build_topological_graph, save_graph_to_json
from mongo_upload import upload_graph_to_mongo

def main():
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    mongo_uri = os.getenv("MONGO_URI")
    
    # 1. Path where your images are saved
    images_dir = "data/nodes"
    
    # 2. Extract embeddings
    print(f"Extracting embeddings from images in {images_dir}...")
    embeddings_dict = extract_features_from_directory(images_dir, api_key)
    
    if not embeddings_dict:
        print("No images found or failed to extract embeddings. Please check your data/nodes folder.")
        return

    # 3. Manually define your Node Information
    # The extractor uses the filename (without extension) as the ID.
    # We will build the nodes list by pairing IDs with their embeddings.
    nodes_data = []
    
    # Optional: You can provide human-readable names for the nodes here
    node_names = {
        "room_010": "My Room",
        "entrance": "Main Entrance",
        "gallary": "Gallary",
        "inside_room_010": "Inside Room 101"
    }

    for file_id, vector in embeddings_dict.items():
        # If file is named "room_101-1.jpg", the base_node_id becomes "room_101"
        base_node_id = file_id.split('-')[0]
        
        nodes_data.append({
            "id": base_node_id, 
            "name": node_names.get(base_node_id, base_node_id), 
            "descriptor_vector": vector,
            "variant_id": file_id # Keeps track of which exact image this vector came from
        })

    # 4. Manually define your Edges Information
    # Define how people navigate between the nodes
    edges_data = [
        {
            "from_node": "entrance",
            "to_node": "room_010",
            "audio_instruction": "Walk Strainght, until u get a elevated surfase and turn right"
        },
        {
            "from_node": "room_010",
            "to_node": "entrance",
            "audio_instruction": "Get up on the elevated surface walk left for the sink and walk right for the washing machine"
        },
        {
            "from_node": "entrance",
            "to_node": "gallary",
            "audio_instruction": "Walk straight aheah"
        },
        {
            "from_node": "gallary",
            "to_node": "entrance",
            "audio_instruction": "Walk back to where u left"
        },
        {
            "from_node": "room_010",
            "to_node": "gallary",
            "audio_instruction": "Get out of the room turn right sense the elevated surface and step up"
        },{
            "from_node": "gallary",
            "to_node": "room_010",
            "audio_instruction": "step down and turn right."
        },
        {
            "from_node": "inside_room_010",
            "to_node": "room_010",
            "audio_instruction": "move toward the door"
        }
       
    ]

    # 5. Build and save the JSON Graph
    print("Building topological graph...")
    graph_json = build_topological_graph(nodes_data, edges_data)
    save_graph_to_json(graph_json, "graph.json")
    print("Saved graph.json locally!")
    
    # 6. Upload to MongoDB Atlas
    print("Uploading to MongoDB Atlas...")
    upload_graph_to_mongo(graph_json, mongo_uri)
    print("Upload complete!")

if __name__ == "__main__":
    main()
