'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';

interface TranscriptData {
  type: string;
  sessionId: string;
  interim?: boolean;
  originalText?: string;
  translatedText?: string;
  language?: string;
  timestamp?: string;
  error?: string;
}

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.session as string;

  const [transcripts, setTranscripts] = useState<TranscriptData[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSessionInfo();
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId]);

  useEffect(() => {
    // Auto-scroll al último transcript
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [transcripts, preview]);

  const fetchSessionInfo = async () => {
    try {
      const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
      const response = await fetch(`${backendHttp}/sessions/${sessionId}`);
      if (!response.ok) throw new Error('Sesión no encontrada');
      
      const data = await response.json();
      setSessionInfo(data);
    } catch (err) {
      setError('Error cargando información de la sesión');
      console.error(err);
    }
  };

  const connectWebSocket = () => {
    const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
    const wsUrl = `${backendHttp.replace(/^http/, 'ws')}/stream/${sessionId}`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      setConnected(true);
      setError(null);
      console.log('Conectado al WebSocket');
    };

    wsRef.current.onmessage = (event) => {
      try {
        const data: TranscriptData = JSON.parse(event.data);
        
        if (data.type === 'transcript') {
          if (data.interim) {
            // Vivo del broadcaster: se muestra pero no se guarda
            setPreview(data.translatedText ?? '');
          } else {
            setPreview(null);
            setTranscripts(prev => [...prev, data]);
          }
        } else if (data.type === 'error') {
          setError(data.error || 'Error en la conexión');
        } else if (data.type === 'connected') {
          setSessionInfo(data);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('Error en la conexión WebSocket');
    };

    wsRef.current.onclose = () => {
      setConnected(false);
      console.log('WebSocket desconectado');
      
      // Reintentar conexión después de 3 segundos
      setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 3000);
    };
  };

  const handleBack = () => {
    window.location.href = '/';
  };

  return (
    <div className="container">
      <button className="back-button" onClick={handleBack}>
        ← Volver a sesiones
      </button>

      <div className="header">
        <h1>🎙️ Subtítulos en vivo</h1>
        <p>
          {sessionInfo?.room || 'Cargando...'}
          {sessionInfo?.hasBroadcaster && ' ● EN VIVO'}
          {connected && ' ✅ Conectado'}
          {!connected && ' ⏳ Conectando...'}
        </p>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <div className="subtitle-container" ref={containerRef}>
        {transcripts.length === 0 && !preview ? (
          <div className="subtitle-text">
            Esperando transcripción...
          </div>
        ) : (
          transcripts.map((transcript, index) => (
            <div key={index} style={{ marginBottom: '1.5rem' }}>
              {transcript.originalText && (
                <div className="subtitle-text original">
                  {transcript.originalText}
                </div>
              )}
              <div className="subtitle-text">
                {transcript.translatedText}
              </div>
              <div style={{ 
                color: '#64748b', 
                fontSize: '0.8rem', 
                marginTop: '0.5rem',
                textAlign: 'center' 
              }}>
                {transcript.timestamp && new Date(transcript.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))
        )}
        {preview && (
          <div className="subtitle-text" style={{ opacity: 0.6 }}>
            {preview}…
          </div>
        )}
      </div>
    </div>
  );
}
