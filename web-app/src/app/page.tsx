"use client";
import { useState } from "react";
import CameraScanner from "@/components/CameraScanner";
import GraphManager from "@/components/GraphManager";
import Navigator from "@/components/Navigator";

export default function Home() {
  const [view, setView] = useState<'scanner' | 'manager' | 'navigator'>('navigator');

  return (
    <main className="main-layout">
      <header className="app-header">
        <h1>Raahi Vision</h1>
        <div className="nav-tabs">
          <button
            className={`nav-btn ${view === 'scanner' ? 'active' : ''}`}
            onClick={() => setView('scanner')}
          >
            Scanner
          </button>
          <button
            className={`nav-btn ${view === 'navigator' ? 'active' : ''}`}
            onClick={() => setView('navigator')}
          >
            Navigator
          </button>
          <button
            className={`nav-btn ${view === 'manager' ? 'active' : ''}`}
            onClick={() => setView('manager')}
          >
            Graph
          </button>
          <a className="nav-btn" href="/wearable" target="_blank" rel="noopener noreferrer">
            Wearable
          </a>
        </div>
      </header>
      <section className="content-section">
        {view === 'scanner' && <CameraScanner />}
        {view === 'manager' && <GraphManager />}
        {view === 'navigator' && <Navigator />}
      </section>
      <footer className="app-footer">
        <p>Empowering mobility with AI</p>
      </footer>
    </main>
  );
}
