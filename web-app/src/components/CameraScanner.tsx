"use client";

import React, { useState, ChangeEvent, useRef, useEffect } from 'react';

export default function CameraScanner() {
  const [mode, setMode] = useState<'manual' | 'live'>('manual');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hazardText, setHazardText] = useState<string | null>(null);

  // Live mode states
  const [isLive, setIsLive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const localizationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechPriorityRef = useRef<number>(0);
  const [localizeText, setLocalizeText] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      stopLiveMode();
    };
  }, []);

  const handleImageCapture = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();

      reader.onload = async (event) => {
        const base64DataUrl = event.target?.result as string;
        setImageSrc(base64DataUrl);
        const base64String = base64DataUrl.split(',')[1];
        await analyzeImage(base64String);
      };

      reader.readAsDataURL(file);
    }
  };

  const scheduleNextCapture = (delay: number = 4000) => {
    intervalRef.current = setTimeout(async () => {
      const nextDelay = await captureFrame();
      scheduleNextCapture(nextDelay || 4000);
    }, delay);
  };

  const startLiveMode = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setIsLive(true);

      // Capture first frame immediately, then start dynamic loop
      intervalRef.current = setTimeout(async () => {
        const nextDelay = await captureFrame();
        scheduleNextCapture(nextDelay || 4000);
      }, 1000);

      // Start 10-second localization loop
      localizationIntervalRef.current = setInterval(() => {
        localizeFrame();
      }, 2500);
    } catch (err) {
      console.error(err);
      setHazardText("Error accessing camera. Please check permissions.");
    }
  };

  const stopLiveMode = () => {
    if (intervalRef.current) clearTimeout(intervalRef.current);
    if (localizationIntervalRef.current) clearInterval(localizationIntervalRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsLive(false);
  };

  const captureFrame = async (): Promise<number> => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Ensure video has actual dimensions
      if (video.videoWidth === 0 || video.videoHeight === 0) return 4000;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // compress image significantly to save bandwidth and API time
        const base64DataUrl = canvas.toDataURL('image/jpeg', 0.5);
        setImageSrc(base64DataUrl);
        const base64String = base64DataUrl.split(',')[1];

        return await analyzeImage(base64String);
      }
    }
    return 4000;
  };

  const localizeFrame = async () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64DataUrl = canvas.toDataURL('image/jpeg', 0.5);
        const base64String = base64DataUrl.split(',')[1];

        try {
          const response = await fetch(`/api/localize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_base64: base64String }),
          });
          const data = await response.json();
          if (data.status === 'match') {
            const msg = `We reached ${data.node.name}`;
            setLocalizeText(msg);
            speakHazard(msg, 1);
          } else {
            setLocalizeText(null);
          }
        } catch (err) {
          console.error("Localization error:", err);
        }
      }
    }
  };

  const analyzeImage = async (base64String: string): Promise<number> => {
    setLoading(true);
    let nextDelay = 4000;

    try {
      const detectRes = await fetch(`/api/vision/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image_base64: base64String }),
      });

      const detectData = await detectRes.json();
      if (detectData.status === 'ok') {
        const hazardText = detectData.hazard;

        if (hazardText.toLowerCase() !== "path is clear") {
          speakHazard(hazardText, 3);
          setHazardText(`${hazardText} (Scoring...)`);
        } else {
          setHazardText(hazardText);
        }

        const scoreRes = await fetch(`/api/vision/score`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ hazard_text: hazardText }),
        });

        const scoreData = await scoreRes.json();
        if (scoreData.status === 'ok') {
          const severity = scoreData.severity || 1;
          setHazardText(`${hazardText} (Severity: ${severity})`);

          if (severity >= 4) {
            nextDelay = 1000;
          } else if (severity <= 2) {
            nextDelay = 5000;
          }
        }
      } else {
        setHazardText("Error analyzing image.");
        speakHazard("Error analyzing image.", 2);
      }
    } catch (err) {
      console.error(err);
      setHazardText("Failed to connect to backend.");
      speakHazard("Failed to connect to backend.", 2);
    } finally {
      setLoading(false);
    }

    return nextDelay;
  };

  const speakHazard = (text: string, priority: number) => {
    if ('speechSynthesis' in window) {
      if (window.speechSynthesis.speaking && speechPriorityRef.current === 1 && priority === 2) {
        return;
      }
      window.speechSynthesis.cancel();
      speechPriorityRef.current = priority;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      utterance.onend = () => { speechPriorityRef.current = 0; };
      utterance.onerror = () => { speechPriorityRef.current = 0; };
      window.speechSynthesis.speak(utterance);
    }
  };

  const switchMode = (newMode: 'manual' | 'live') => {
    if (newMode === 'manual' && isLive) {
      stopLiveMode();
    }
    setMode(newMode);
    setImageSrc(null);
    setHazardText(null);
    setLocalizeText(null);
  };

  return (
    <div className="scanner-container">
      <div className="card">
        <h2 className="card-title">Vision Hazard Scanner</h2>
        {/* <p className="card-subtitle">
          {mode === 'manual' ? "Tap to scan your surroundings." : "Continuous scanning (4s localize, 7s hazard)."}
        </p> */}

        <div className="tab-switcher">
          <button
            className={`tab-btn ${mode === 'manual' ? 'active' : ''}`}
            onClick={() => switchMode('manual')}
          >
            Manual Mode
          </button>
          <button
            className={`tab-btn ${mode === 'live' ? 'active' : ''}`}
            onClick={() => switchMode('live')}
          >
            Live Mode
          </button>
        </div>

        {mode === 'manual' && (
          <label className="capture-btn">
            <span>📸 Tap to Scan Environment</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageCapture}
              className="hidden-input"
            />
          </label>
        )}

        {mode === 'live' && (
          <div className="live-section">
            {!isLive ? (
              <button className="primary-btn live-start-btn" onClick={startLiveMode}>
                ▶ Start Live Mode
              </button>
            ) : (
              <button className="primary-btn live-stop-btn" onClick={stopLiveMode}>
                ⏹ Stop Live Mode
              </button>
            )}

            <div className={`video-wrapper ${isLive ? 'active-pulse' : ''}`} style={{ display: isLive ? 'block' : 'none' }}>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="live-video"
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {isLive && <div className="scanner-line"></div>}
            </div>
          </div>
        )}

        {loading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <p>{mode === 'live' ? 'Analyzing frame...' : 'Analyzing surroundings...'}</p>
          </div>
        )}

        {hazardText && (
          <div className={`result-box ${hazardText.includes('Error') || hazardText.includes('Failed') ? 'error' : 'success'}`}>
            <p className="hazard-text">{hazardText}</p>
            <button className="replay-btn" onClick={() => speakHazard(hazardText, 2)}>
              🔊 Replay Audio
            </button>
          </div>
        )}

        {localizeText && (
          <div className="result-box success" style={{ background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
            <p className="hazard-text">📍 {localizeText}</p>
          </div>
        )}

        {mode === 'manual' && imageSrc && (
          <div className="image-preview">
            <img src={imageSrc} alt="Captured environment" />
          </div>
        )}
      </div>
    </div>
  );
}
