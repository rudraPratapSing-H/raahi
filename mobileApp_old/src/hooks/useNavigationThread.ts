import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import Tts from 'react-native-tts';
import { cosineSimilarity } from '../utils/math';
import { fetchTopologicalGraph } from '../services/mongoService';

export interface GraphNode {
  id: string;
  name: string;
  descriptor_vector: number[];
}

export interface GraphEdge {
  from_node: string;
  to_node: string;
  audio_instruction: string;
}

export function useNavigationThread(apiKey: string) {
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const isProcessing = useRef(false);
  const genaiClient = useRef<any>(null);

  useEffect(() => {
    // Initialize Audio
    Tts.setDefaultLanguage('en-US');
    Tts.setDefaultRate(0.5);

    if (apiKey) {
      genaiClient.current = new GoogleGenAI({ apiKey });
    }

    // Fetch the graph from MongoDB Atlas
    fetchTopologicalGraph().then(graph => {
      if (graph) {
        setNodes(graph.nodes);
        setEdges(graph.edges);
      }
    }).catch(err => console.error("Failed to load graph:", err));
  }, [apiKey]);

  const processFrameForNavigation = async (base64Image: string) => {
    // THROTTLE: Drop frame if an API call is already in progress
    if (isProcessing.current) {
      console.log("API call in flight, dropping frame.");
      return;
    }

    if (!genaiClient.current || nodes.length === 0) {
      console.warn("Client or Graph data not initialized.");
      return;
    }

    isProcessing.current = true;

    try {
      // 1. Feature Extraction via Gemini SDK
      const response = await genaiClient.current.models.embedContent({
        model: 'gemini-embedding-2',
        contents: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: base64Image
            }
          }
        ]
      });

      const queryVector = response.embeddings?.[0]?.values;
      if (!queryVector) throw new Error("No embedding returned");

      // 2. Node Math & Matcher (Cosine Similarity)
      let bestMatch: GraphNode | null = null;
      let highestScore = -1;

      for (const node of nodes) {
        const score = cosineSimilarity(queryVector, node.descriptor_vector);
        if (score > highestScore) {
          highestScore = score;
          bestMatch = node;
        }
      }

      // 3. Validation & TTS Audio Triggers
      if (highestScore > 0.85 && bestMatch) {
        const isAdjacent = currentNodeId 
          ? edges.some(e => e.from_node === currentNodeId && e.to_node === bestMatch!.id) 
          : true;

        if (isAdjacent || !currentNodeId) {
          setCurrentNodeId(bestMatch.id);
          
          // Look up audio instruction for the path ahead
          const nextEdge = edges.find(e => e.from_node === bestMatch!.id);
          if (nextEdge) {
            Tts.speak(nextEdge.audio_instruction);
          } else {
             Tts.speak(`You have reached ${bestMatch.name}. Navigation complete.`);
          }
        }
      } else {
        console.log("No confident match found from image.");
      }
    } catch (error) {
      console.error("Error processing frame:", error);
    } finally {
      isProcessing.current = false;
    }
  };

  return {
    currentNodeId,
    processFrameForNavigation
  };
}
