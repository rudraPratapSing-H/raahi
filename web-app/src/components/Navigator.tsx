"use client";

import React, { useState, useEffect, useRef } from 'react';

export default function Navigator() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [startNode, setStartNode] = useState('');
  const [endNode, setEndNode] = useState('');
  const [pathSteps, setPathSteps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Journey state
  const [journeyActive, setJourneyActive] = useState(false);
  const [visitedIndex, setVisitedIndex] = useState(0);
  const visitedIndexRef = useRef(0);
  const [hazardText, setHazardText] = useState<string | null>(null);
  const [autoLocating, _setAutoLocating] = useState(false);
  const autoLocatingRef = useRef(false);
  const setAutoLocating = (val: boolean) => {
    autoLocatingRef.current = val;
    _setAutoLocating(val);
  };
  const [locatingStatus, setLocatingStatus] = useState<string | null>(null);

  // Refs for live camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null); // For localization
  const hazardIntervalRef = useRef<NodeJS.Timeout | null>(null); // For hazards
  const streamRef = useRef<MediaStream | null>(null);
  const speechPriorityRef = useRef<number>(0);
  const missedNodeCountRef = useRef<number>(0);
  const consecutiveHazardsRef = useRef<number>(0);
  const [blockedEdges, setBlockedEdges] = useState<string[]>([]);

  useEffect(() => {
    fetchNodes();
    return () => stopJourney();
  }, []);

  useEffect(() => {
    visitedIndexRef.current = visitedIndex;
  }, [visitedIndex]);

  const fetchNodes = async () => {
    try {
      const response = await fetch(`/api/graph`);
      const data = await response.json();
      setNodes(data.nodes || []);
    } catch (err) {
      console.error(err);
    }
  };

  const calculatePath = async (overrideStart?: string, overrideEnd?: string, currentBlockedEdges?: string[]) => {
    const start = overrideStart || startNode;
    const end = overrideEnd || endNode;
    const blocked = currentBlockedEdges || blockedEdges;
    if (!start || !end) return;
    
    setLoading(true);
    setErrorMsg(null);
    try {
      const startEncoded = encodeURIComponent(start);
      const endEncoded = encodeURIComponent(end);
      const blockedEncoded = encodeURIComponent(blocked.join(','));
      const response = await fetch(`/api/path?start=${startEncoded}&end=${endEncoded}&blocked_edges=${blockedEncoded}`);
      const data = await response.json();
      if (data.status === 'ok') {
        setPathSteps(data.steps);
        setVisitedIndex(0);
      } else {
        setErrorMsg(data.detail || 'Path not found');
        setPathSteps([]);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  };

  const startCamera = async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
    } catch (err) {
      console.error(err);
      setErrorMsg("Error accessing camera.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const startAutoLocate = () => {
    setErrorMsg(null);
    setLocatingStatus("Starting auto-localization...");
    setAutoLocating(true);
    
    // Give React a moment to render the video element
    setTimeout(async () => {
      await startCamera();
      speak("Scanning location. Please hold the phone up.", 1);
      setTimeout(() => {
        performScanTurn(1, 1);
      }, 2000);
    }, 100);
  };

  const performScanTurn = async (turn: number, attempt: number = 1) => {
    if (!autoLocatingRef.current) return; // cancelled
    if (turn > 4) {
      setLocatingStatus("Failed to localize.");
      speak("Location not recognized. Please move to a different spot and try again, or select your location manually.", 1);
      setAutoLocating(false);
      stopCamera();
      return;
    }
    
    setLocatingStatus(`Scanning Turn ${turn}/4 (Attempt ${attempt}/3)...`);
    const base64String = getBase64Frame();
    if (!base64String) {
       setTimeout(() => performScanTurn(turn, attempt), 1000);
       return;
    }

    try {
      const locRes = await fetch(`/api/localize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64String }),
      });
      const locData = await locRes.json();
      
      if (locData.status === 'match') {
        const matchedNode = locData.node;
        setStartNode(matchedNode.id);
        speak(`You are at ${matchedNode.name}.`, 1);
        setLocatingStatus(`Found location: ${matchedNode.name}`);
        setTimeout(() => setAutoLocating(false), 2000);
        stopCamera();
        return;
      }
    } catch (e) {
      console.error(e);
    }
    
    // No match
    if (attempt < 3) {
      setTimeout(() => {
        performScanTurn(turn, attempt + 1);
      }, 1000); // Try again quickly at the same angle
    } else if (turn < 4) {
      speak("Location not found. Please turn 90 degrees to your right.", 1);
      setLocatingStatus("Please turn 90 degrees right...");
      setTimeout(() => {
        performScanTurn(turn + 1, 1);
      }, 2500);
    } else {
      performScanTurn(5, 1);
    }
  };

  const startJourney = async () => {
    if (pathSteps.length === 0) return;
    
    setJourneyActive(true);
    setTimeout(async () => {
      await startCamera();
      
      if (pathSteps[0].instruction) {
        speak(`Starting journey from ${pathSteps[0].node_name}. ${pathSteps[0].instruction}`, 1);
      } else {
        speak("Starting journey.", 1);
      }
      
      const locLoop = async () => {
        await processLocalizeFrame();
        intervalRef.current = setTimeout(locLoop, 4000); // 4 seconds localization
      };
      
      const hazLoop = async () => {
        const nextDelay = await processHazardFrame();
        hazardIntervalRef.current = setTimeout(hazLoop, nextDelay);
      };

      intervalRef.current = setTimeout(locLoop, 2000);
      hazardIntervalRef.current = setTimeout(hazLoop, 4000);
    }, 100);
  };

  const stopJourney = () => {
    if (intervalRef.current) clearTimeout(intervalRef.current);
    if (hazardIntervalRef.current) clearTimeout(hazardIntervalRef.current);
    stopCamera();
    setJourneyActive(false);
  };

  const getBase64Frame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.videoWidth === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
  };

  const processLocalizeFrame = async () => {
    const base64String = getBase64Frame();
    if (!base64String) return;

    const currentIndex = visitedIndexRef.current;
    if (currentIndex + 1 < pathSteps.length) {
      await checkLocalization(base64String, currentIndex);
    }
  };

  const processHazardFrame = async (): Promise<number> => {
    const base64String = getBase64Frame();
    if (!base64String) return 4000;

    try {
      const detectRes = await fetch(`/api/vision/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64String }),
      });
      const detectData = await detectRes.json();
      
      if (detectData.status === 'ok') {
        const hazardText = detectData.hazard;
        
        if (hazardText.toLowerCase() !== "path is clear") {
          speak(hazardText, 3); // Speak immediately, assume mild priority initially
          setHazardText(`${hazardText} (Scoring...)`);
        } else {
          setHazardText(hazardText);
        }
        
        const scoreRes = await fetch(`/api/vision/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hazard_text: hazardText }),
        });
        const scoreData = await scoreRes.json();
        
        if (scoreData.status === 'ok') {
          const severity = scoreData.severity || 1;
          setHazardText(`${hazardText} (Severity: ${severity})`);
          
          let nextDelay = 4000; // Base delay
          if (severity >= 4) {
            nextDelay = 1000; // Danger mode tracking
            consecutiveHazardsRef.current += 1;
          } else {
            if (severity <= 2) {
              nextDelay = 5000; // Safe mode
            }
            consecutiveHazardsRef.current = 0;
          }
          
          if (consecutiveHazardsRef.current >= 5) {
            consecutiveHazardsRef.current = 0;
            const currentIndex = visitedIndexRef.current;
            if (currentIndex + 1 < pathSteps.length) {
              const u = pathSteps[currentIndex].node_id;
              const v = pathSteps[currentIndex + 1].node_id;
              const edgeToBlock = `${u}|${v}`;
              
              speak(`Severe hazard blocking the path. Please turn around and return to ${pathSteps[currentIndex].node_name}.`, 1);
              
              const newBlockedEdges = [...blockedEdges, edgeToBlock];
              setBlockedEdges(newBlockedEdges);
              
              calculatePath(u, endNode, newBlockedEdges);
            }
          }
          
          return nextDelay;
        }
      }
    } catch (e) { console.error(e); }
    
    return 4000;
  };

  const checkLocalization = async (base64String: string, currentIndex: number): Promise<boolean> => {
    try {
      const nextNode = pathSteps[currentIndex + 1];
      const isLost = missedNodeCountRef.current >= 12;
      
      const payload: any = { image_base64: base64String };
      if (!isLost) {
        payload.target_node_id = nextNode.node_id;
      }

      const locRes = await fetch(`/api/localize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const locData = await locRes.json();
      
      if (locData.status === 'match') {
        const matchedNodeId = locData.node.id;
        
        if (matchedNodeId === nextNode.node_id) {
          // Auto-progress!
          missedNodeCountRef.current = 0;
          setVisitedIndex(currentIndex + 1);
          setHazardText(`📍 Reached: ${nextNode.node_name}`);
          
          let speech = `Reached ${nextNode.node_name}. `;
          if (currentIndex + 1 === pathSteps.length - 1) {
             speech += "You have arrived at your destination.";
             stopJourney();
          } else if (nextNode.instruction) {
             speech += nextNode.instruction;
          }
          speak(speech, 1);
          return true;
        } else if (isLost) {
          // We found a completely different node! REROUTE!
          missedNodeCountRef.current = 0;
          speak(`You seem to be off route. Recalculating route from ${locData.node.name}.`, 1);
          setHazardText(`🔄 Rerouting from: ${locData.node.name}`);
          
          stopJourney();
          setStartNode(matchedNodeId);
          await calculatePath(matchedNodeId, endNode);
          return true;
        }
      } else {
        // No match
        missedNodeCountRef.current += 1;
      }
    } catch (e) { 
      console.error(e); 
      missedNodeCountRef.current += 1;
    }
    return false;
  };

  const speak = (text: string, priority: number) => {
    if ('speechSynthesis' in window) {
      // If we are currently speaking a high priority message (1) 
      // and a low priority message (2) tries to play, ignore the low priority message.
      if (window.speechSynthesis.speaking && speechPriorityRef.current === 1 && priority === 2) {
        return;
      }

      window.speechSynthesis.cancel();
      speechPriorityRef.current = priority;
      
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      
      utterance.onend = () => {
        speechPriorityRef.current = 0;
      };
      utterance.onerror = () => {
        speechPriorityRef.current = 0;
      };

      window.speechSynthesis.speak(utterance);
    }
  };

  const repeatInstruction = () => {
    if (!pathSteps || pathSteps.length === 0) return;
    const currentStep = pathSteps[visitedIndex];
    if (visitedIndex === pathSteps.length - 1) {
      speak(`You have arrived at ${currentStep.node_name}.`, 1);
    } else {
      let speech = `You are at ${currentStep.node_name}. `;
      if (currentStep.instruction) {
        speech += currentStep.instruction;
      } else if (visitedIndex + 1 < pathSteps.length) {
        speech += `Head towards ${pathSteps[visitedIndex + 1].node_name}.`;
      }
      speak(speech, 1);
    }
  };

  return (
    <div className="manager-container">
      <div className="card">
        <h2 className="card-title">Pathfinder</h2>
        <p className="card-subtitle">Follow the route safely to your destination.</p>
        
        <div className="live-section" style={{ display: (journeyActive || autoLocating) ? 'flex' : 'none', marginBottom: '20px' }}>
          <div className="video-wrapper active-pulse">
            <video ref={videoRef} autoPlay playsInline muted className="live-video" />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="scanner-line"></div>
          </div>
          {hazardText && journeyActive && (
            <div className="result-box success" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
              <p className="hazard-text">{hazardText}</p>
            </div>
          )}
        </div>

        {autoLocating && (
          <div className="auto-locate-box">
             <h3 style={{ color: 'var(--accent)', marginBottom: '10px', textAlign: 'center' }}>{locatingStatus}</h3>
             <button className="primary-btn" onClick={() => { setAutoLocating(false); stopCamera(); speak("Auto locate cancelled.", 1); }} style={{ width: '100%', background: 'var(--danger)' }}>
                ⏹ Cancel Auto-Locate
             </button>
          </div>
        )}

        {!journeyActive && !autoLocating && (
          <div className="form-section">
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <select value={startNode} onChange={e => setStartNode(e.target.value)} className="styled-input" style={{ flex: 1, marginBottom: 0 }}>
                <option value="">Select Start Node</option>
                {nodes.map((n, idx) => <option key={`${n.id}-${idx}`} value={n.id}>{n.name} ({n.id})</option>)}
              </select>
              <button className="primary-btn" onClick={startAutoLocate} style={{ padding: '0 20px', height: '48px', background: 'var(--accent)', flexShrink: 0, width: 'auto' }}>
                🎯 Auto-Locate
              </button>
            </div>
            
            <select value={endNode} onChange={e => setEndNode(e.target.value)} className="styled-input" style={{ marginTop: '15px' }}>
              <option value="">Select Destination</option>
              {nodes.map((n, idx) => <option key={`${n.id}-${idx}`} value={n.id}>{n.name} ({n.id})</option>)}
            </select>
            
            <button className="primary-btn" onClick={() => calculatePath()} disabled={loading}>
              {loading ? 'Calculating...' : 'Find Route'}
            </button>
            {errorMsg && <p className="status-msg" style={{color: 'var(--danger)'}}>{errorMsg}</p>}
            {locatingStatus && !locatingStatus.includes("Failed") && <p className="status-msg success" style={{color: 'var(--accent)'}}>{locatingStatus}</p>}
          </div>
        )}

        {pathSteps.length > 0 && !autoLocating && (
          <div className="timeline-section">
            <div className="timeline">
              {pathSteps.map((step, idx) => (
                <div key={idx} className={`timeline-step ${idx < visitedIndex ? 'visited' : ''} ${idx === visitedIndex ? 'current' : ''}`}>
                  <div className="timeline-marker"></div>
                  <div className="timeline-content">
                    <h3>{step.node_name}</h3>
                    {step.instruction && idx >= visitedIndex && idx < pathSteps.length - 1 && (
                      <p className="instruction">➔ {step.instruction}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {!journeyActive ? (
              <button className="primary-btn live-start-btn" onClick={startJourney}>
                ▶ Start Journey
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                <button className="primary-btn" onClick={repeatInstruction} style={{ flex: 1, background: 'var(--accent)', padding: '15px' }}>
                  🔁 Repeat Instruction
                </button>
                <button className="primary-btn live-stop-btn" onClick={stopJourney} style={{ flex: 1 }}>
                  ⏹ Stop Journey
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
