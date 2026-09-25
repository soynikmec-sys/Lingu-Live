'use client';

import { useEffect, useState, useRef } from 'react';
import { ArrowLeft, History, Volume2, VolumeX, X, Trash2 } from 'lucide-react';
import { sameText, tailSentences } from './text';

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

export default function SessionViewer({ sessionId }: { sessionId: string }) {
  const [transcripts, setTranscripts] = useState<TranscriptData[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Frame JPEG de la cámara del anfitrión (fondo, espejo como en el mic).
  const [videoFrame, setVideoFrame] = useState<string | null>(null);
  // Modo overlay para OBS (?overlay=1): fondo transparente, solo el
  // subtítulo actual en cajita negra.
  const [overlay, setOverlay] = useState(false);
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
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('overlay') === '1') {
        setOverlay(true);
        document.body.style.background = 'transparent';
      }
    } catch { /* ignorar */ }
    fetchSessionInfo();
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      try { ttsAudioRef.current?.pause(); } catch { /* ignorar */ }
      actxRef.current?.close().catch(() => {});
      try {
        document.body.style.background = '';
      } catch { /* ignorar */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    // Auto-scroll al último transcript
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    const el = dockRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
        } else if (data.type === 'video-frame' && typeof data.data === 'string') {
          // Cámara del anfitrión (fondo, espejo como en el mic)
          setVideoFrame(data.data);
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

  // Overlay OBS: solo subtítulo actual en cajita negra, fondo transparente.
  if (overlay) {
    const current = preview
      ? { translatedText: preview, originalText: null as string | null }
      : transcripts.length > 0
        ? transcripts[transcripts.length - 1]
        : null;
    return (
      <div className="overlay-root">
        {current && (current.translatedText || current.originalText) ? (
          <div className="overlay-box">
            <div className="overlay-main">
              {current.translatedText || current.originalText}
            </div>
            {current.originalText &&
              current.originalText.trim() !== (current.translatedText ?? '').trim() && (
                <div className="overlay-original">{current.originalText}</div>
              )}
          </div>
        ) : null}
      </div>
    );
  }

  // Espejo del anfitrión: misma disposición (video fondo, título
  // arriba-izquierda, dock abajo, historial lateral), sin botones de
  // mic/cámara/modo. Solo queda el audio dual (original + traducida).
  const latest = transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;
  const history = [...transcripts].reverse();
  const title = sessionInfo?.room
    ? `Viendo ${sessionInfo.room}${sessionInfo?.hasBroadcaster ? ' ● EN VIVO' : ''}`
    : 'Subtítulos en vivo';

  const handleClearHistory = () => {
    setTranscripts(prev => (prev.length > 0 ? [prev[prev.length - 1]] : []));
  };

  return (
    <>
    {videoFrame && (
      <img
        src={videoFrame}
        alt=""
        aria-hidden
        className="stage-fullscreen-img"
      />
    )}
    <div className={videoFrame ? 'container mic-overlay' : 'container'}>
      <button
        className="back-fab"
        onClick={handleBack}
        aria-label="Volver a sesiones"
        title="Volver a sesiones"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="mic-titlebar">
        <span className="mic-title">{title}</span>
        <span className="mic-status">{connected ? 'Conectado' : 'Conectando...'}</span>
      </div>

      <div className="top-right-bar">
        <button
          className="history-fab inline"
          onClick={() => setHistoryOpen(!historyOpen)}
          aria-label={historyOpen ? 'Cerrar historial' : 'Abrir historial'}
          title={historyOpen ? 'Cerrar historial' : 'Abrir historial'}
        >
          {historyOpen ? <X size={20} /> : <History size={20} />}
          {transcripts.length > 0 && (
            <span className="history-badge">{transcripts.length}</span>
          )}
        </button>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <div className="live-dock" ref={dockRef}>
        {latest ? (
          <>
            <div className="live-current">
              {tailSentences(latest.translatedText)}
            </div>
            {latest.originalText && !sameText(latest) && (
              <div className="live-current original">
                {tailSentences(latest.originalText)}
              </div>
            )}
            {latest.timestamp && (
              <div className="live-timestamp">
                {new Date(latest.timestamp).toLocaleTimeString()}
              </div>
            )}
          </>
        ) : (
          !(preview) && (
            <div className="live-placeholder">
              {connected ? 'Esperando transcripción...' : 'Conectando...'}
            </div>
          )
        )}
        {preview && (
          <div className="live-next">
            <div className="live-current">
              {`${preview}…`}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={handleToggleAudio}
        className={`aud-fab ${audioOn ? 'on' : 'off'}`}
        aria-label={audioOn ? 'Apagar audio del directo' : 'Escuchar directo'}
        title="Original bajito + traducción en voz alta"
      >
        {audioOn ? <Volume2 size={26} /> : <VolumeX size={26} />}
      </button>

      {historyOpen && (
        <aside className="history-panel">
          <div className="history-header">
            <h2>Historial ({transcripts.length})</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {history.length > 0 && (
                <button className="history-clear" onClick={handleClearHistory} title="Limpiar historial">
                  <Trash2 size={16} />
                </button>
              )}
              <button className="history-clear" onClick={() => setHistoryOpen(false)} title="Cerrar">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <div className="history-empty">
                Acá van a aparecer las transcripciones anteriores
              </div>
            ) : (
              history.map((transcript, index) => (
                <div key={index} className="history-item">
                  <div>{transcript.translatedText}</div>
                  {transcript.originalText && !sameText(transcript) && (
                    <div className="history-original">
                      {transcript.originalText}
                    </div>
                  )}
                  {transcript.timestamp && (
                    <time>{new Date(transcript.timestamp).toLocaleTimeString()}</time>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>
      )}
    </div>
    </>
  );
}
