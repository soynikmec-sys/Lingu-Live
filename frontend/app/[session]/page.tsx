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
  data?: string;
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
  // Audio dual del directo: original (bajito, en vivo) + traducida (TTS).
  const [audioOn, setAudioOn] = useState(false);
  const audioOnRef = useRef(false);
  audioOnRef.current = audioOn;
  const actxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const queueRef = useRef<Float32Array[]>([]);
  const nextTimeRef = useRef(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const base64ToF32 = (b64: string): Float32Array | null => {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const i16 = new Int16Array(bytes.buffer);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      return f32;
    } catch {
      return null;
    }
  };

  // Bombea la cola con jitter buffer: programa ahead, dropea si atrasa >1s.
  const pumpOriginal = () => {
    const ctx = actxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain || ctx.state !== 'running') return;
    const q = queueRef.current;
    if (q.length < 2) return;
    if (nextTimeRef.current < ctx.currentTime) {
      if (ctx.currentTime - nextTimeRef.current > 1) {
        q.length = 0;
        nextTimeRef.current = ctx.currentTime + 0.05;
        return;
      }
      nextTimeRef.current = ctx.currentTime + 0.05;
    }
    while (q.length > 0) {
      const chunk = q.shift()!;
      const buf = ctx.createBuffer(1, chunk.length, 16000);
      buf.getChannelData(0).set(chunk);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      src.start(nextTimeRef.current);
      nextTimeRef.current += chunk.length / 16000;
    }
  };

  const playTranslated = async (text: string, lang?: string) => {
    try {
      const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
      const res = await fetch(`${backendHttp}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: lang || 'es' }),
      });
      if (!res.ok || !audioOnRef.current) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try { ttsAudioRef.current?.pause(); } catch { /* ignorar */ }
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      console.warn('TTS viewer falló:', e);
    }
  };

  const handleToggleAudio = async () => {
    if (audioOn) {
      setAudioOn(false);
      queueRef.current = [];
      try { ttsAudioRef.current?.pause(); } catch { /* ignorar */ }
      try { await actxRef.current?.suspend(); } catch { /* ignorar */ }
      return;
    }
    try {
      if (!actxRef.current) {
        const ctx = new AudioContext({ sampleRate: 16000 });
        const gain = ctx.createGain();
        gain.gain.value = 0.3; // original bajito, la traducida manda
        gain.connect(ctx.destination);
        actxRef.current = ctx;
        gainRef.current = gain;
      }
      await actxRef.current.resume();
      nextTimeRef.current = actxRef.current.currentTime + 0.1;
      setAudioOn(true);
    } catch (e) {
      console.error('No se pudo activar audio:', e);
    }
  };

  useEffect(() => {
    fetchSessionInfo();
    connectWebSocket();
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      try { ttsAudioRef.current?.pause(); } catch { /* ignorar */ }
      actxRef.current?.close().catch(() => {});
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
            // Traducida en voz alta (solo finales, solo si el audio está on)
            if (audioOnRef.current && (data.translatedText ?? '').trim()) {
              playTranslated(data.translatedText ?? '', data.language);
            }
          }
        } else if (data.type === 'audio' && typeof data.data === 'string') {
          // Audio ORIGINAL del que transmite (bajito, en vivo)
          if (!audioOnRef.current) return;
          const f32 = base64ToF32(data.data);
          if (f32) {
            queueRef.current.push(f32);
            if (queueRef.current.length > 40) queueRef.current.splice(0, queueRef.current.length - 40);
            pumpOriginal();
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
        <button
          className="back-button"
          onClick={handleToggleAudio}
          style={{ marginTop: '0.75rem' }}
          aria-label={audioOn ? 'Apagar audio del directo' : 'Escuchar directo'}
          title="Original bajito + traducción en voz alta"
        >
          {audioOn ? '🔊 Audio on' : '🔇 Audio off'}
        </button>
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
