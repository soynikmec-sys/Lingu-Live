'use client';

import { useState, useRef, useEffect } from 'react';

// Demo lengua de señas (alcance demo, no producto): 2 frases fijas.
// El usuario "enseña" cada seña haciéndola 3 veces; después se detecta
// por comparación de secuencias de landmarks (MediaPipe, on-device).
// Lo detectado entra al flujo normal como transcripción (se traduce igual).

const PHRASES = ['hola', 'buenos días'];
const SAMPLES_NEEDED = 3;
const RECORD_MS = 4000;
const SEQ_LEN = 24;
const MATCH_THRESHOLD = 0.14;
const COOLDOWN_MS = 3000;
const STORE_KEY = 'lingo-sign-templates-v1';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

type Seq = number[][]; // frames x 63 (21 landmarks xyz normalizados)

// Invariante a posición y tamaño: relativo a muñeca, escala por dedo medio.
function normalize(lm: any[]): number[] {
  const w = lm[0];
  const mx = lm[9].x - w.x;
  const my = lm[9].y - w.y;
  const mz = (lm[9].z ?? 0) - (w.z ?? 0);
  const ref = Math.hypot(mx, my, mz) || 1;
  const out: number[] = [];
  for (const p of lm) {
    out.push((p.x - w.x) / ref, (p.y - w.y) / ref, ((p.z ?? 0) - (w.z ?? 0)) / ref);
  }
  return out;
}

function resample(frames: number[][], n: number): Seq {
  if (frames.length === 0) return [];
  if (frames.length === 1) return Array.from({ length: n }, () => [...frames[0]]);
  const out: Seq = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (frames.length - 1);
    const a = Math.floor(pos);
    const b = Math.min(a + 1, frames.length - 1);
    const f = pos - a;
    out.push(frames[a].map((v, j) => v + (frames[b][j] - v) * f));
  }
  return out;
}

function seqDist(a: Seq, b: Seq): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].length; j++) {
      const d = a[i][j] - b[i][j];
      s += d * d;
    }
  }
  return Math.sqrt(s / (a.length * a[0].length));
}

function loadTemplates(): Record<string, Seq[]> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignorar */ }
  return {};
}

interface SignLanguageProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraOn: boolean;
  onPhrase: (text: string) => void;
}

export default function SignLanguage({ videoRef, cameraOn, onPhrase }: SignLanguageProps) {
  const [on, setOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [handSeen, setHandSeen] = useState(false);
  const [status, setStatus] = useState('');
  const [templates, setTemplates] = useState<Record<string, Seq[]>>({});
  const [recording, setRecording] = useState<string | null>(null);

  const landmarkerRef = useRef<any>(null);
  const windowRef = useRef<number[][]>([]);
  const lastHandRef = useRef(0);
  const recFramesRef = useRef<number[][]>([]);
  const recordingRef = useRef<string | null>(null);
  const lastDetectRef = useRef(0);
  const lastCheckRef = useRef(0);
  const onPhraseRef = useRef(onPhrase);
  onPhraseRef.current = onPhrase;
  const onRef = useRef(false);
  onRef.current = on;

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  const persist = (t: Record<string, Seq[]>) => {
    setTemplates(t);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(t));
    } catch { /* ignorar */ }
  };

  const ensureLandmarker = async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    // Import nativo (no webpack) para el bundle CDN ESM.
    const vision = await new Function('u', 'return import(u)')(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
    );
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
    const lm = await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    landmarkerRef.current = lm;
    return lm;
  };

  const toggle = async () => {
    if (on) {
      setOn(false);
      setRecording(null);
      recordingRef.current = null;
      return;
    }
    if (!cameraOn) {
      setStatus('Prendé la cámara primero 📷');
      return;
    }
    setLoading(true);
    setStatus('Cargando detector de manos…');
    try {
      await ensureLandmarker();
      setStatus('');
      setOn(true);
    } catch (e) {
      console.error('MediaPipe falló:', e);
      setStatus('No se pudo cargar el detector (revisá internet).');
    } finally {
      setLoading(false);
    }
  };

  // Loop de lectura: graba ejemplos o detecta, según estado.
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    let lastUi = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      try {
        const video = videoRef.current;
        const lm = landmarkerRef.current;
        if (!video || !lm || video.readyState < 2) return;
        const res = lm.detectForVideo(video, performance.now());
        const hand = res?.landmarks?.[0];
        const now = Date.now();
        if (hand) {
          lastHandRef.current = now;
          const normed = normalize(hand);
          if (recordingRef.current) {
            recFramesRef.current.push(normed);
          } else {
            windowRef.current.push(normed);
            if (windowRef.current.length > 60) windowRef.current.shift();
          }
        } else if (now - lastHandRef.current > 600) {
          windowRef.current = [];
        }
        if (now - lastUi > 500) {
          lastUi = now;
          setHandSeen(now - lastHandRef.current < 800);
        }
        // Detección (solo si no está grabando ejemplos)
        if (!recordingRef.current && now - lastCheckRef.current > 200) {
          lastCheckRef.current = now;
          const win = windowRef.current;
          if (win.length >= 14) {
            const seq = resample(win.slice(-SEQ_LEN), SEQ_LEN);
            let best = '';
            let bestD = Infinity;
            for (const [phrase, samples] of Object.entries(templates)) {
              if (samples.length < SAMPLES_NEEDED) continue;
              for (const s of samples) {
                const d = seqDist(seq, s);
                if (d < bestD) {
                  bestD = d;
                  best = phrase;
                }
              }
            }
            if (best && bestD < MATCH_THRESHOLD && now - lastDetectRef.current > COOLDOWN_MS) {
              lastDetectRef.current = now;
              windowRef.current = [];
              console.log(`🤟 Seña detectada: ${best} (d=${bestD.toFixed(3)})`);
              onPhraseRef.current(best);
            }
          }
        }
      } catch (e) {
        console.error('Loop señas:', e);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, cameraOn, templates]);

  const startRecording = (phrase: string) => {
    recFramesRef.current = [];
    recordingRef.current = phrase;
    setRecording(phrase);
    setStatus(`Hacé la seña de "${phrase}" por 4 segundos…`);
    setTimeout(() => {
      const frames = recFramesRef.current;
      recordingRef.current = null;
      setRecording(null);
      if (frames.length < 10) {
        setStatus('No se vio la mano, reintentá más cerca de la cámara.');
        return;
      }
      const seq = resample(frames, SEQ_LEN);
      setTemplates((prev) => {
        const next = { ...prev, [phrase]: [...(prev[phrase] || []), seq].slice(-SAMPLES_NEEDED) };
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch { /* ignorar */ }
        return next;
      });
      setStatus(`Ejemplo guardado (${Math.min((templates[phrase]?.length || 0) + 1, SAMPLES_NEEDED)}/${SAMPLES_NEEDED}).`);
    }, RECORD_MS);
  };

  const readyCount = PHRASES.filter((p) => (templates[p] || []).length >= SAMPLES_NEEDED).length;

  return (
    <>
      <button
        onClick={toggle}
        className={`tts-fab ${on ? 'on' : 'off'}`}
        style={{ left: 'auto', right: '1rem' }}
        aria-label={on ? 'Apagar señas' : 'Activar señas'}
        title={on ? 'Apagar señas' : 'Activar señas (demo: hola, buenos días)'}
        disabled={loading}
      >
        <span style={{ fontSize: '1.6rem' }}>🤟</span>
      </button>
      {on && (
        <div
          style={{
            position: 'fixed',
            bottom: '6rem',
            right: '1rem',
            zIndex: 4,
            background: 'rgba(0,0,0,0.85)',
            color: 'white',
            borderRadius: '12px',
            padding: '0.9rem 1rem',
            width: '250px',
            fontSize: '0.85rem',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>
            Señas demo {handSeen ? '✋' : '·'} {readyCount < PHRASES.length ? '(enseñar primero)' : '(detectando)'}
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.75, marginBottom: '0.3rem' }}>
            ¿Cómo son?{' '}
            <a href="https://xn--lenguadeseas-jhb.com.ar/saludos-en-lengua-de-senas/" target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>
              guía saludos LSA
            </a>{' '}
            · “Hola”: mano en alto, palma afuera, saludo corto.
          </div>
          {PHRASES.map((p) => {
            const n = (templates[p] || []).length;
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                <span style={{ flex: 1 }}>“{p}” {n}/{SAMPLES_NEEDED}</span>
                <button
                  onClick={() => startRecording(p)}
                  disabled={recording !== null}
                  title={n >= SAMPLES_NEEDED ? 'Vuelve a grabar (reemplaza el ejemplo más viejo)' : 'Grabar ejemplo'}
                  style={{
                    background: recording === p ? '#ef4444' : 'white',
                    color: recording === p ? 'white' : '#667eea',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  {recording === p ? '●' : n >= SAMPLES_NEEDED ? 'Regrabar' : 'Grabar'}
                </button>
              </div>
            );
          })}
          <button
            onClick={() => {
              persist({});
              setStatus('Ejemplos borrados.');
            }}
            style={{
              background: 'transparent',
              color: 'rgba(255,255,255,0.6)',
              border: 'none',
              fontSize: '0.75rem',
              cursor: 'pointer',
              marginTop: '0.4rem',
              padding: 0,
            }}
          >
            Borrar ejemplos
          </button>
          {status && <div style={{ marginTop: '0.4rem', opacity: 0.85 }}>{status}</div>}
        </div>
      )}
    </>
  );
}
