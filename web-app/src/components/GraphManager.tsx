"use client";

import React, { useState, useEffect, ChangeEvent } from 'react';

export default function GraphManager() {
  const [activeTab, setActiveTab] = useState<'node' | 'edge'>('node');

  // Node State
  const [nodeId, setNodeId] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [nodeMessage, setNodeMessage] = useState<string | null>(null);

  // Edge State
  const [nodes, setNodes] = useState<any[]>([]);
  const [startNode, setStartNode] = useState('');
  const [endNode, setEndNode] = useState('');
  const [instructionFwd, setInstructionFwd] = useState('');
  const [instructionRev, setInstructionRev] = useState('');
  const [edgeLoading, setEdgeLoading] = useState(false);
  const [edgeMessage, setEdgeMessage] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'edge') {
      fetchNodes();
    }
  }, [activeTab]);

  const fetchNodes = async () => {
    try {
      // Need to adjust localhost to local IP for mobile devices
      const response = await fetch(`/api/graph`);
      const data = await response.json();
      setNodes(data.nodes || []);
    } catch (err) {
      console.error(err);
    }
  };

  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          let scaleSize = 1;
          if (img.width > MAX_WIDTH) {
            scaleSize = MAX_WIDTH / img.width;
          }
          canvas.width = img.width * scaleSize;
          canvas.height = img.height * scaleSize;
          
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
              } else {
                reject(new Error('Canvas to Blob failed'));
              }
            }, 'image/jpeg', 0.6);
          }
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleImageCapture = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (images.length >= 5) {
        alert("Maximum 5 images allowed");
        return;
      }
      
      try {
        const file = e.target.files[0];
        const compressedFile = await compressImage(file);
        
        setImages([...images, compressedFile]);
        
        const reader = new FileReader();
        reader.onload = (event) => {
          setImagePreviews([...imagePreviews, event.target?.result as string]);
        };
        reader.readAsDataURL(compressedFile);
      } catch (err) {
        console.error("Error compressing image:", err);
      }
    }
  };

  const submitNode = async () => {
    if (!nodeId || !nodeName || images.length === 0) {
      setNodeMessage("Please provide ID, Name, and at least 1 image.");
      return;
    }
    
    setNodeLoading(true);
    setNodeMessage(null);
    
    const formData = new FormData();
    formData.append('node_id', nodeId);
    formData.append('node_name', nodeName);
    images.forEach((img) => {
      formData.append('images', img);
    });

    try {
      const response = await fetch(`/api/graph/node`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.status === 'ok') {
        setNodeMessage(data.message);
        setNodeId('');
        setNodeName('');
        setImages([]);
        setImagePreviews([]);
      } else {
        setNodeMessage(`Error: ${data.detail}`);
      }
    } catch (err) {
      console.error(err);
      setNodeMessage("Failed to connect to backend.");
    } finally {
      setNodeLoading(false);
    }
  };

  const submitEdge = async () => {
    if (!startNode || !endNode || !instructionFwd || !instructionRev) {
      setEdgeMessage("Please fill in all fields.");
      return;
    }
    
    setEdgeLoading(true);
    setEdgeMessage(null);
    
    const formData = new FormData();
    formData.append('start_node_id', startNode);
    formData.append('end_node_id', endNode);
    formData.append('instruction_fwd', instructionFwd);
    formData.append('instruction_rev', instructionRev);

    try {
      const response = await fetch(`/api/graph/edge`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.status === 'ok') {
        setEdgeMessage(data.message);
        setStartNode('');
        setEndNode('');
        setInstructionFwd('');
        setInstructionRev('');
      } else {
        setEdgeMessage(`Error: ${data.detail}`);
      }
    } catch (err) {
      console.error(err);
      setEdgeMessage("Failed to connect to backend.");
    } finally {
      setEdgeLoading(false);
    }
  };

  return (
    <div className="manager-container">
      <div className="card">
        <h2 className="card-title">Graph Manager</h2>
        
        <div className="tab-switcher">
          <button 
            className={`tab-btn ${activeTab === 'node' ? 'active' : ''}`}
            onClick={() => setActiveTab('node')}
          >
            Create Node
          </button>
          <button 
            className={`tab-btn ${activeTab === 'edge' ? 'active' : ''}`}
            onClick={() => setActiveTab('edge')}
          >
            Create Edge
          </button>
        </div>

        {activeTab === 'node' && (
          <div className="form-section">
            <input 
              type="text" 
              placeholder="Node ID (e.g., room_010)" 
              value={nodeId} 
              onChange={e => setNodeId(e.target.value)} 
              className="styled-input"
            />
            <input 
              type="text" 
              placeholder="Node Name (e.g., Kitchen)" 
              value={nodeName} 
              onChange={e => setNodeName(e.target.value)} 
              className="styled-input"
            />
            
            <div className="image-grid">
              {imagePreviews.map((src, idx) => (
                <div key={idx} className="thumb">
                  <img src={src} alt="preview" />
                </div>
              ))}
              {images.length < 5 && (
                <label className="thumb-add">
                  <span>+ Photo</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment" 
                    onChange={handleImageCapture} 
                    className="hidden-input"
                  />
                </label>
              )}
            </div>
            <p className="photo-count">{images.length} / 5 photos taken</p>
            
            {nodeMessage && <p className="status-msg">{nodeMessage}</p>}
            
            <button className="primary-btn" onClick={submitNode} disabled={nodeLoading}>
              {nodeLoading ? 'Generating Node...' : 'Generate Node'}
            </button>
          </div>
        )}

        {activeTab === 'edge' && (
          <div className="form-section">
            <select value={startNode} onChange={e => setStartNode(e.target.value)} className="styled-input">
              <option value="">Select Start Node</option>
              {nodes.map((n, idx) => <option key={`${n.id}-${idx}`} value={n.id}>{n.name} ({n.id})</option>)}
            </select>
            
            <div className="edge-arrow">↓</div>
            
            <select value={endNode} onChange={e => setEndNode(e.target.value)} className="styled-input">
              <option value="">Select End Node</option>
              {nodes.map((n, idx) => <option key={`${n.id}-${idx}`} value={n.id}>{n.name} ({n.id})</option>)}
            </select>
            
            <textarea 
              placeholder="Instruction: Start ➝ End (e.g., Walk 5 steps forward)" 
              value={instructionFwd} 
              onChange={e => setInstructionFwd(e.target.value)} 
              className="styled-input textarea"
            />
            <textarea 
              placeholder="Instruction: End ➝ Start (e.g., Turn around and walk 5 steps)" 
              value={instructionRev} 
              onChange={e => setInstructionRev(e.target.value)} 
              className="styled-input textarea"
            />
            
            {edgeMessage && <p className="status-msg">{edgeMessage}</p>}
            
            <button className="primary-btn" onClick={submitEdge} disabled={edgeLoading}>
              {edgeLoading ? 'Generating Edges...' : 'Generate Edges'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
