from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pymongo import MongoClient
from pydantic import BaseModel
from typing import Optional
import os
import io
import json
import itertools
import base64
from dotenv import load_dotenv
import google.generativeai as genai
from google import genai as genai_new
from google.genai import types
import math
from PIL import Image

load_dotenv()

app = FastAPI()

# Allow CORS for the React Native app during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise ValueError("MONGO_URI not found in environment variables")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_KEY2 = os.getenv("GEMINI_API_KEY2")
GEMINI_API_KEY3 = os.getenv("GEMINI_API_KEY3")

# Demo-day rate-limit mitigation: cycle /api/vision/find calls across every
# configured key so a free-tier per-key quota is spread across all of them.
# This only helps if the quota is enforced per-key rather than per-account -
# verify that before relying on it live. Each call below builds its own
# genai_new.Client(api_key=...) (not the global genai.configure() the older
# /api/vision/detect endpoint uses), so rotating keys here never mutates that
# endpoint's configured key.
GEMINI_VISION_KEYS = [k for k in (GEMINI_API_KEY, GEMINI_API_KEY2, GEMINI_API_KEY3) if k]
_vision_key_cycle = itertools.cycle(GEMINI_VISION_KEYS) if GEMINI_VISION_KEYS else None


def next_vision_key():
    if not _vision_key_cycle:
        raise HTTPException(status_code=500, detail="No Gemini API key configured")
    return next(_vision_key_cycle)

client = MongoClient(MONGO_URI)
db = client["navigation"]
nodes_collection = db["topological_graph_nodes"]
edges_collection = db["topological_graph_edges"]

# Configure Gemini for the vision hazard endpoint
if GEMINI_API_KEY2:
    genai.configure(api_key=GEMINI_API_KEY2)

# ─────────────────────────────────────────────
# GET /api/graph — existing endpoint
# ─────────────────────────────────────────────
@app.get("/api/graph")
def get_graph():
    """
    Returns the topological graph (nodes and edges) from MongoDB.
    """
    # Fetch nodes, excluding the MongoDB specific _id field for cleaner JSON response
    nodes = list(nodes_collection.find({}, {"_id": 0}))
    
    # Fetch edges, excluding _id
    edges = list(edges_collection.find({}, {"_id": 0}))
    
    return {
        "nodes": nodes,
        "edges": edges
    }

# ─────────────────────────────────────────────
# POST /api/graph/node — add a node to the graph
# ─────────────────────────────────────────────
@app.post("/api/graph/node")
async def add_node(
    images: list[UploadFile] = File(...),
    node_id: str = Form(...),
    node_name: str = Form(...),
):
    """
    Accepts multiple images + metadata, extracts Gemini embeddings for each,
    averages them, and inserts the node into MongoDB.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured on server")

    if not images or len(images) == 0:
        raise HTTPException(status_code=400, detail="At least one image is required")

    embed_client = genai_new.Client(api_key=GEMINI_API_KEY)
    all_vectors = []

    try:
        for image in images:
            image_bytes = await image.read()
            mime_type = image.content_type or "image/jpeg"
            
            part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            response = embed_client.models.embed_content(
                model='gemini-embedding-2',
                contents=part,
                config=types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT"
                )
            )
            if not response.embeddings or not response.embeddings[0].values:
                raise ValueError("No embeddings returned from Gemini")
            all_vectors.append(list(response.embeddings[0].values))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract embedding: {e}")
        
    # Average the vectors
    num_images = len(all_vectors)
    vec_len = len(all_vectors[0])
    avg_vector = [sum(vec[i] for vec in all_vectors) / num_images for i in range(vec_len)]

    # Build the node document
    node_doc = {
        "id": node_id,
        "name": node_name,
        "descriptor_vector": avg_vector,
        "variant_id": node_id,
    }

    # Upsert into MongoDB (update if node_id exists, insert otherwise)
    nodes_collection.update_one(
        {"id": node_id},
        {"$set": node_doc},
        upsert=True,
    )

    return {
        "status": "ok",
        "message": f"Node '{node_id}' added/updated successfully with {num_images} images",
        "embedding_dimensions": len(avg_vector),
    }

# ─────────────────────────────────────────────
# POST /api/graph/edge — add an edge to the graph
# ─────────────────────────────────────────────
@app.post("/api/graph/edge")
async def add_edge(
    start_node_id: str = Form(...),
    end_node_id: str = Form(...),
    instruction_fwd: str = Form(...),
    instruction_rev: str = Form(...)
):
    """
    Creates bidirectional edges between two nodes.
    """
    # Create start -> end
    edge_fwd = {
        "start_node_id": start_node_id,
        "end_node_id": end_node_id,
        "instruction": instruction_fwd,
    }
    
    # Create end -> start
    edge_rev = {
        "start_node_id": end_node_id,
        "end_node_id": start_node_id,
        "instruction": instruction_rev,
    }

    # Upsert to avoid duplicates
    edges_collection.update_one(
        {"start_node_id": start_node_id, "end_node_id": end_node_id},
        {"$set": edge_fwd},
        upsert=True
    )
    
    edges_collection.update_one(
        {"start_node_id": end_node_id, "end_node_id": start_node_id},
        {"$set": edge_rev},
        upsert=True
    )

    return {
        "status": "ok",
        "message": f"Edges between '{start_node_id}' and '{end_node_id}' added successfully",
    }

# ─────────────────────────────────────────────
# POST /api/vision/detect
# ─────────────────────────────────────────────
class DetectRequest(BaseModel):
    image_base64: str

@app.post("/api/vision/detect")
async def vision_detect(payload: DetectRequest):
    if not GEMINI_API_KEY2:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY2 not configured on server")

    # Decode base64 image
    try:
        image_data = base64.b64decode(payload.image_base64)
        img = Image.open(io.BytesIO(image_data))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

    # 1. Vision prompt (Uses GEMINI_API_KEY2 via global configure)
    prompt_vision = (
        "You are a mobility instructor for a visually impaired person. "
        "Scan this image for physical hazards (furniture, people, steps, poles, etc.). "
        "Map their position using clock-face directions. "
        "CRITICAL: Estimate the distance to the hazard as accurately as possible in steps (1 step ≈ 2.5 feet). "
        "Look at the visible floor space, perspective, and where the object meets the ground to judge distance. "
        "Return ONLY a short description under 10 words (e.g., 'Couch at 12 o'clock, 2 steps ahead'). If clear, say 'Path is clear'."
    )

    try:
        model = genai.GenerativeModel('gemini-3.5-flash-lite')
        response = model.generate_content([prompt_vision, img])
        hazard_text = response.text.strip()
        print(f"[DEBUG Gemini Vision Output]: {hazard_text}")
    except Exception as e:
        print(f"[DEBUG Gemini Vision Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini Vision API error: {e}")

    return {
        "status": "ok",
        "hazard": hazard_text
    }

# ─────────────────────────────────────────────
# POST /api/vision/score
# ─────────────────────────────────────────────
class ScoreRequest(BaseModel):
    hazard_text: str

@app.post("/api/vision/score")
async def vision_score(payload: ScoreRequest):
    if not GEMINI_API_KEY3:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY3 not configured on server")

    hazard_text = payload.hazard_text

    # 2. Text scoring prompt (Uses GEMINI_API_KEY3 explicitly)
    prompt_score = (
        f"Given the following hazard description for a blind pedestrian: '{hazard_text}'\n"
        "Score the severity from 1 to 5. 1 = safe/clear, 2 = distant object, 3 = moderate hazard within 5 steps, 4 = severe hazard within 2-3 steps, 5 = extreme immediate collision danger (1 step away).\n"
        "Return ONLY a single integer from 1 to 5, nothing else."
    )

    try:
        client3 = genai_new.Client(api_key=GEMINI_API_KEY3)
        response_score = client3.models.generate_content(
            model='gemini-3.5-flash-lite',
            contents=prompt_score
        )
        severity_text = response_score.text.strip()
        print(f"[DEBUG Gemini Score Output]: {severity_text}")
        severity = int(severity_text)
    except Exception as e:
        print(f"[DEBUG Gemini Score Error]: {e}")
        severity = 1

    return {
        "status": "ok",
        "severity": severity,
    }


# ─────────────────────────────────────────────
# POST /api/vision/find — camera-driven "find X" (new, separate from /api/vision/detect)
# ─────────────────────────────────────────────
class FindRequest(BaseModel):
    image_base64: str
    target: str
    lang: str = "en"

@app.post("/api/vision/find")
async def vision_find(payload: FindRequest):
    try:
        image_data = base64.b64decode(payload.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

    # Single-purpose, stateless prompt: one frame, one target, one small
    # structured answer. No multi-step reasoning is asked of the model - a
    # fast/free-tier model is reliable at this, not at open-ended reasoning.
    prompt = (
        f"Look at this single image. The user is searching for: '{payload.target}'. "
        "Look for the object/place itself OR any sign/label pointing to it. "
        f"Respond in {payload.lang}. Respond with ONLY a compact JSON object, no other text, no markdown fences: "
        '{"visible": true or false, '
        '"direction": one of "left", "slightly_left", "ahead", "slightly_right", "right", "behind", "unknown", '
        '"distance_hint": one of "near", "far", or null, '
        '"note": "<max 8 words, e.g. what a sign said>"}'
    )

    try:
        find_client = genai_new.Client(api_key=next_vision_key())
        img_part = types.Part.from_bytes(data=image_data, mime_type="image/jpeg")
        response = find_client.models.generate_content(
            model='gemini-3.5-flash-lite',
            contents=[prompt, img_part],
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        raw = response.text.strip().strip('`')
        if raw.lower().startswith('json'):
            raw = raw[4:].strip()
        parsed = json.loads(raw)
    except Exception as e:
        # A fast/free-tier model will occasionally wrap JSON in prose or emit
        # something unparseable - fall back to a well-formed "not found"
        # response rather than a 500, so the client always has something safe
        # to speak.
        print(f"[DEBUG vision/find error]: {e}")
        parsed = {"visible": False, "direction": "unknown", "distance_hint": None, "note": ""}

    return {
        "status": "ok",
        "visible": bool(parsed.get("visible", False)),
        "direction": parsed.get("direction") or "unknown",
        "distance_hint": parsed.get("distance_hint"),
        "note": parsed.get("note", ""),
    }


def cosine_similarity(v1, v2):
    dot_product = sum(a * b for a, b in zip(v1, v2))
    mag1 = math.sqrt(sum(a * a for a in v1))
    mag2 = math.sqrt(sum(b * b for b in v2))
    if mag1 == 0 or mag2 == 0:
        return 0.0
    return dot_product / (mag1 * mag2)

class LocalizeRequest(BaseModel):
    image_base64: str

@app.post("/api/localize")
async def localize(payload: LocalizeRequest):
    """
    Accepts a base64 image, extracts Gemini embedding, and compares 
    with all known nodes. If max similarity > 0.85, returns a match.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        image_data = base64.b64decode(payload.image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

    # Extract embedding
    try:
        embed_client = genai_new.Client(api_key=GEMINI_API_KEY)
        part = types.Part.from_bytes(data=image_data, mime_type="image/jpeg")
        response = embed_client.models.embed_content(
            model='gemini-embedding-2',
            contents=part,
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_DOCUMENT"
            )
        )
        if not response.embeddings or not response.embeddings[0].values:
            raise ValueError("No embeddings returned from Gemini")
        query_vector = list(response.embeddings[0].values)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract embedding: {e}")

    # Fetch nodes
    nodes = list(nodes_collection.find({}, {"_id": 0}))
    
    best_match = None
    best_score = -1.0

    for node in nodes:
        node_vector = node.get("descriptor_vector")
        if not node_vector or len(node_vector) == 0:
            continue
        score = cosine_similarity(query_vector, node_vector)
        if score > best_score:
            best_score = score
            best_match = node

    if best_match and best_score > 0.85:
        return {
            "status": "match",
            "node": best_match,
            "similarity": best_score
        }
    else:
        return {
            "status": "no_match",
            "similarity": best_score if best_score != -1.0 else 0
        }

@app.get("/api/path")
def get_path(start: str, end: str, blocked_edges: str = ""):
    """
    Finds the shortest path from start to end node using BFS on MongoDB edges.
    `blocked_edges` is an optional comma-separated string of 'start_id|end_id' edges to avoid.
    Returns the ordered list of nodes and instructions.
    """
    nodes_cursor = list(nodes_collection.find({}, {"_id": 0}))
    edges_cursor = list(edges_collection.find({}, {"_id": 0}))

    blocked_set = set()
    if blocked_edges:
        for edge_str in blocked_edges.split(','):
            parts = edge_str.split('|')
            if len(parts) == 2:
                blocked_set.add((parts[0], parts[1]))
                
    graph = {}
    for node in nodes_cursor:
        graph[node["id"]] = []

    for edge in edges_cursor:
        if "start_node_id" not in edge or "end_node_id" not in edge:
            continue
        u = edge["start_node_id"]
        v = edge["end_node_id"]
        instr = edge.get("instruction", "")
        if u not in graph:
            graph[u] = []
        graph[u].append({"to": v, "instruction": instr})

    if start not in graph or end not in graph:
        return {"status": "error", "detail": "Start or End node does not exist."}

    from collections import deque
    queue = deque([(start, [start], [])]) 
    visited = set([start])

    best_path_nodes = None
    best_path_instructions = None

    while queue:
        current, path, instructions = queue.popleft()

        if current == end:
            best_path_nodes = path
            best_path_instructions = instructions
            break

        for neighbor in graph.get(current, []):
            nxt = neighbor["to"]
            if (current, nxt) in blocked_set:
                continue # Skip blocked edge!
            if nxt not in visited:
                visited.add(nxt)
                queue.append((nxt, path + [nxt], instructions + [neighbor["instruction"]]))

    if not best_path_nodes:
        return {"status": "error", "detail": "No path found."}

    steps = []
    for i in range(len(best_path_nodes)):
        node_id = best_path_nodes[i]
        node_data = next((n for n in nodes_cursor if n["id"] == node_id), None)
        steps.append({
            "node_id": node_id,
            "node_name": node_data["name"] if node_data else node_id,
            "instruction": best_path_instructions[i] if i < len(best_path_instructions) else None
        })

    return {
        "status": "ok",
        "steps": steps
    }

# ─────────────────────────────────────────────
# Static web app — mounted LAST so it doesn't shadow any /api/* route above.
# Starlette matches routes in registration order; StaticFiles(html=True)
# serves web-app/index.html for "/" and falls through for unknown paths.
# ─────────────────────────────────────────────
app.mount("/", StaticFiles(directory="web-app", html=True), name="web-app")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
