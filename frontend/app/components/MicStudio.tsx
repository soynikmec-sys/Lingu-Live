'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, CircleHelp, History, Trash2, Video, VideoOff, Volume2, VolumeX, X } from 'lucide-react';
import MicrophoneRecorder from '../components/MicrophoneRecorder';
import LanguagePicker from '../components/LanguagePicker';

interface TranscriptData {
  type: string;
  source?: string;
  interim?: boolean;
  originalText?: string;
  translatedText?: string;
  language?: string;
  timestamp?: string;
  error?: string;
}

interface MicStudioProps {
  // Si se indica, todo lo transcripto se PUBLICA en esa sesión (sala).
  // Si es null, funciona standalone como /mic (sin publicar).
  sessionId?: string | null;
  // Título y destino del botón volver (por defecto, home de salas)
  title?: string;
  backHref?: string;
}

export default function MicStudio({ sessionId = null, title = 'Transcripción de Micrófono', backHref = '/' }: MicStudioProps) {
  const [transcripts, setTranscripts] = useState<TranscriptData[]>([]);
  const [previewOrig, setPreviewOrig] = useState('');
  const [previewTrans, setPreviewTrans] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechLang, setSpeechLang] = useState('es-ES');
  const [targetLang, setTargetLang] = useState('es');
  const [historyOpen, setHistoryOpen] = useState(false);
  // Sin pills: el modo es automático. Mismo idioma = local gratis
  // (Web Speech, sin backend). Idioma cruzado en /mic = Live.
  // En salas (/transmitir) el cruzado sigue por texto para no dejar
  // mudos a los viewers (el broadcast no maneja audio Live).
  const wsRef = useRef<WebSocket | null>(null);
  // No reintentar cuando el servidor nos rechaza a propósito
  // (sala ocupada / sesión inexistente): reintentar sería un loop infinito.
  const noRetryRef = useRef(false);
  const interimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInterimSendRef = useRef(0);
  const lastSentInterimRef = useRef('');
  const interimInflightRef = useRef(false);
  // Diagnóstico Live: contar chunks enviados y avisar dropeos una sola vez.
  const audioSentCountRef = useRef(0);
  const audioDropWarnedRef = useRef(false);
  // Último interim sin finalizar (para rescate al frenar) y su timer.
  const lastInterimTextRef = useRef('');
  const rescueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;
  const targetLangRef = useRef(targetLang);
  targetLangRef.current = targetLang;
  // El objeto recognition del navegador se crea una vez y captura los
  // handlers viejos: por eso sameLanguage se lee vía ref (siempre actual)
  // y no directo del state (quedaría congelado al cambiar de idioma
  // con el micrófono activado).
  const sameLanguageRef = useRef(true);
  // Dock de transcripción: autoscroll abajo cuando llega texto nuevo,
  // sin barra de scroll visible.
  const dockRef = useRef<HTMLDivElement | null>(null);
  // Overlay para OBS (?overlay=1): solo subtítulo en cajita negra, sin
  // cámara ni controles. Vale para /mic y /transmitir (el anfitrión lo
  // usa directo sin abrir el viewer).
  const [overlay, setOverlay] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('overlay') === '1') {
        setOverlay(true);
        document.body.style.background = 'transparent';
      }
    } catch { /* ignorar */ }
    return () => {
      try {
        document.body.style.background = '';
      } catch { /* ignorar */ }
    };
  }, []);
  // Lectura en voz alta (TTS del navegador, gratis). Opcional: al prender,
  // cada final commiteado se lee en su idioma. Anti-eco: mientras habla
  // se mutea la entrada (+800ms cooldown) y jamás se leen interim.
  const [ttsAuto, setTtsAuto] = useState(false);
  const ttsAutoRef = useRef(false);
  ttsAutoRef.current = ttsAuto;
  const ttsSpeakingRef = useRef(false);
  const ttsCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reproductor del MP3 de edge-tts (voz masculina HD). Si falla, se usa
  // la voz del sistema como fallback.
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);

  const stopTtsAudio = () => {
    try {
      ttsAudioRef.current?.pause();
    } catch { /* ignorar */ }
    ttsAudioRef.current = null;
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    if (ttsCooldownRef.current) clearTimeout(ttsCooldownRef.current);
    ttsSpeakingRef.current = false;
  };

  const markSpeaking = () => {
    ttsSpeakingRef.current = true;
  };

  const markSilent = () => {
    if (ttsCooldownRef.current) clearTimeout(ttsCooldownRef.current);
    ttsCooldownRef.current = setTimeout(() => {
      ttsSpeakingRef.current = false;
    }, 800);
  };

  const pickVoice = (lang: string) => {
    try {
      const vs = window.speechSynthesis?.getVoices() ?? [];
      const prefix = (lang || '').split('-')[0].toLowerCase();
      return vs.find((v) => (v.lang || '').toLowerCase().startsWith(prefix)) ?? null;
    } catch {
      return null;
    }
  };

  const speak = (text: string, lang: string) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth || !text.trim()) return;
      synth.cancel();
      if (ttsCooldownRef.current) clearTimeout(ttsCooldownRef.current);
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(lang);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = lang;
      }
      markSpeaking();
      u.onend = markSilent;
      u.onerror = () => {
        ttsSpeakingRef.current = false;
      };
      synth.speak(u);
    } catch (e) {
      console.error('Error en TTS:', e);
      ttsSpeakingRef.current = false;
    }
  };

  // Voz HD masculina vía backend (edge-tts). Si falla, fallback a sistema.
  const speakHD = async (text: string, lang: string) => {
    const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
    try {
      stopTtsAudio();
      const res = await fetch(`${backendHttp}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang }),
      });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      ttsUrlRef.current = url;
      const audio = new Audio(url);
      ttsAudioRef.current = audio;
      markSpeaking();
      audio.onended = markSilent;
      audio.onerror = () => {
        console.warn('⚠️ TTS HD falló, usando voz del sistema');
        speak(text, lang);
      };
      await audio.play();
    } catch (e) {
      console.warn('⚠️ TTS HD no disponible, usando voz del sistema:', e);
      speak(text, lang);
    }
  };

  const maybeSpeak = (data: TranscriptData) => {
    if (!ttsAutoRef.current) return;
    const text = (data.translatedText ?? '').trim();
    if (!text) return;
    speakHD(text, data.language || targetLangRef.current);
  };

  const handleToggleTts = () => {
    if (ttsAuto) {
      try {
        window.speechSynthesis?.cancel();
      } catch { /* ignorar */ }
      stopTtsAudio();
    }
    setTtsAuto(!ttsAuto);
  };

  useEffect(() => {
    // Las voces cargan async en Chrome: forzar carga temprana.
    try {
      window.speechSynthesis?.getVoices();
    } catch { /* ignorar */ }
    return () => {
      stopTtsAudio();
      try {
        window.speechSynthesis?.cancel();
      } catch { /* ignorar */ }
      if (ttsCooldownRef.current) clearTimeout(ttsCooldownRef.current);
    };
  }, []);

  useEffect(() => {
    const el = dockRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcripts, previewTrans, previewOrig]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Centro: solo lo último en tiempo real. Sidebar: todo el historial,
  // incluida la actual.
  const latest = transcripts.length > 0 ? transcripts[transcripts.length - 1] : null;
  const history = [...transcripts].reverse();

  // En modo demo (o hablando ya en español) original y traducido son el
  // mismo texto: mostrarlo una sola vez para que no parezca duplicado.
  const sameText = (t: TranscriptData) =>
    (t.originalText ?? '').trim() !== '' &&
    t.originalText!.trim() === (t.translatedText ?? '').trim();

  // El Live acumula párrafos largos sin partir: en pantalla se muestran
  // solo las últimas N oraciones (el historial guarda el texto completo).
  const tailSentences = (text: string | undefined, n = 2) => {
    const t = (text ?? '').trim();
    if (!t) return '';
    const parts = t.match(/[^.!?…]+[.!?…]+["”)]?|\S[^.!?…]*$/g);
    if (!parts || parts.length <= n) return t;
    return parts.slice(-n).join(' ').trim();
  };

  const handleClearHistory = () => {
    setTranscripts(prev => (prev.length > 0 ? [prev[prev.length - 1]] : []));
  };

  const connectWebSocket = () => {
    const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
    const path = sessionId ? `/broadcast/${sessionId}` : '/mic-stream';
    const wsUrl = `${backendHttp.replace(/^http/, 'ws')}${path}`;
    noRetryRef.current = false;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      setConnected(true);
      setError(null);
      console.log('Conectado al WebSocket de micrófono');
    };

    wsRef.current.onmessage = (event) => {
      try {
        const data: TranscriptData = JSON.parse(event.data);
        
        if (data.type === 'transcript') {
          if (data.interim) {
            interimInflightRef.current = false;
            if (data.source === 'live-audio') {
              // Live API: hipótesis continua, se aplica por recencia
              setPreviewOrig(data.originalText ?? '');
              setPreviewTrans(data.translatedText ?? '');
              return;
            }
            // Ignorar respuestas viejas que llegan después de un parcial
            // más nuevo o después de la frase final (evita texto rancio).
            if ((data.originalText ?? '') !== lastSentInterimRef.current) return;
            // Traducción parcial en vivo: se muestra en grande pero no
            // se guarda en el historial hasta que llegue la final.
            setPreviewTrans(data.translatedText ?? '');
          } else {
            lastSentInterimRef.current = '';
            interimInflightRef.current = false;
            setTranscripts(prev => [...prev, data]);
            // Sticky: si sigue grabando no se borra el blanco hasta que
            // llegue el próximo interim (evita parpadeo/hueco). Solo se
            // limpia al frenar la grabación.
            if (!isRecordingRef.current) {
              setPreviewOrig('');
              setPreviewTrans('');
            }
            maybeSpeak(data);
          }
        } else if (data.type === 'error') {
          // Errores Live son duros: se muestran y se frena, sin fallback
          // silencioso a texto (decisión del usuario).
          if (data.error === 'live-unavailable') {
            noRetryRef.current = false;
            setError('Live no disponible (sin API key, fondos o cuota). Revisá la key de Gemini.');
            return;
          }
          if (data.error === 'live-disconnected') {
            setError('Se cortó la traducción en vivo. Frená el mic y probá de nuevo.');
            return;
          }
          if (data.error === 'live-error') {
            setError('Error en la traducción en vivo. Frená el mic y probá de nuevo.');
            return;
          }
          const msg = data.error || 'Error en la conexión';
          // Rechazos definitivos del servidor: no reintentar
          if (/ocupada|no encontrada o inactiva/i.test(msg)) {
            noRetryRef.current = true;
          }
          setError(msg);
        } else if (data.type === 'connected') {
          console.log('Conexión de micrófono establecida');
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
      
      // Reintentar conexión después de 3 segundos (salvo rechazo definitivo)
      setTimeout(() => {
        if (noRetryRef.current) return;
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connectWebSocket();
        }
      }, 3000);
    };
  };

  const sendText = (text: string, interim: boolean) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (!interim) console.warn('WebSocket no conectado');
      return;
    }

    try {
      wsRef.current.send(JSON.stringify({
        type: 'text',
        text,
        interim,
        targetLang: targetLangRef.current
      }));
    } catch (error) {
      console.error('Error enviando texto:', error);
    }
  };

  // Si hablás y ves en el mismo idioma no hay nada que traducir:
  // se muestra directo sin llamar a nada (local, $0).
  const sameLanguage = speechLang.split('-')[0] === targetLang;
  sameLanguageRef.current = sameLanguage;
  // Ruteo automático sin pills: cruzado en /mic = Live; en salas = texto.
  const liveEnabled = !sameLanguage && !sessionId;
  const effectiveMode = sameLanguage ? 'local' : liveEnabled ? 'live' : 'text';
  const modeCostLabel =
    effectiveMode === 'local' ? 'Local · $0'
    : effectiveMode === 'live' ? 'Live · ~$2.20/h'
    : 'Texto · gratis';

  const handleAudioChunk = (base64Pcm: string) => {
    // Anti-eco: mientras el TTS habla no se manda audio (ni cooldown).
    if (ttsSpeakingRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      if (!audioDropWarnedRef.current) {
        audioDropWarnedRef.current = true;
        console.warn('⚠️ Audio dropeado: WebSocket no abierto');
      }
      return;
    }
    audioSentCountRef.current++;
    if (audioSentCountRef.current === 1) console.log('📤 Audio chunk #1 enviado al backend, len:', base64Pcm.length);
    else if (audioSentCountRef.current % 100 === 0) console.log(`📤 Audio chunks enviados: ${audioSentCountRef.current}`);
    try {
      wsRef.current.send(JSON.stringify({
        type: 'audio',
        data: base64Pcm,
        targetLang: targetLangRef.current
      }));
    } catch (error) {
      console.error('Error enviando audio:', error);
    }
  };

  const storeLocalTranscript = (text: string) => {
    const entry: TranscriptData = {
      type: 'transcript',
      originalText: text,
      translatedText: text,
      language: targetLang,
      timestamp: new Date().toISOString()
    };
    setTranscripts(prev => [...prev, entry]);
    setPreviewOrig('');
    setPreviewTrans('');
    // Transmitiendo en mismo idioma: publicar el original a la sala
    // (gratis, sin Gemini) para que viewers/OBS lo vean. En /mic no hay
    // sala y no se manda nada.
    if (sessionId && wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          type: 'publish',
          text,
          targetLang: targetLangRef.current
        }));
      } catch (e) {
        console.error('Error publicando original:', e);
      }
    }
    maybeSpeak(entry);
  };

  const handleTranscript = (text: string) => {
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
    if (rescueTimerRef.current) clearTimeout(rescueTimerRef.current);
    // El final cubre lo interino: ya no hay nada que rescatar.
    lastInterimTextRef.current = '';
    if (sameLanguageRef.current) {
      storeLocalTranscript(text);
      return;
    }
    // Solo los finales viajan a Gemini (frase completa, mejor calidad,
    // menos llamadas). Los interim se muestran en local sin traducir.
    sendText(text, false);
  };

  // Interim = preview local instantáneo, SIN red. Traducir parciales
  // generaba texto rancio (frases a medio formar) y gastaba llamadas.
  // La traducción llega con el final, frase completa.
  const handleInterim = (text: string) => {
    setPreviewOrig(text);
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
    if (!text.trim()) return;
    lastInterimTextRef.current = text;
    if (sameLanguageRef.current) {
      // Sin backend: el "blanco" es el mismo texto, en vivo y gratis.
      setPreviewTrans(text);
      return;
    }
    // Cross-idioma: el blanco muestra "…" hasta que llegue el final
    // traducido. El original en vivo ya da feedback instantáneo.
    setPreviewTrans('');
  };

  const handleToggleRecording = () => {
    if (interimTimerRef.current) clearTimeout(interimTimerRef.current);
    if (rescueTimerRef.current) clearTimeout(rescueTimerRef.current);
    // Reintento limpio: al togglear se borra el error anterior.
    setError(null);
    lastSentInterimRef.current = '';
    interimInflightRef.current = false;
    audioSentCountRef.current = 0;
    audioDropWarnedRef.current = false;
    if (isRecording) {
      // Al frenar: Chrome solo finaliza con pausa de silencio. Si hablaste
      // hasta el final sin pausa, lo último nunca llega como final y se
      // perdería: se rescata el último interim como frase final, salvo que
      // un final tardío ya lo haya cubierto (handleTranscript limpia el ref).
      const pending = lastInterimTextRef.current;
      if (pending.trim()) {
        rescueTimerRef.current = setTimeout(() => {
          if (lastInterimTextRef.current !== pending) return;
          lastInterimTextRef.current = '';
          if (sameLanguageRef.current) storeLocalTranscript(pending);
          else sendText(pending, false);
        }, 1200);
      }
    } else {
      lastInterimTextRef.current = '';
    }
    setPreviewOrig('');
    setPreviewTrans('');
    setIsRecording(!isRecording);
  };

  // Cámara en vivo estilo directo (independiente del micrófono)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      // El <video> se monta al activar cameraOn: el stream se conecta
      // en el efecto de abajo, cuando el elemento ya existe.
      setCameraOn(true);
      setCameraError(null);
    } catch {
      setCameraError('No se pudo activar la cámara. Revisá los permisos del navegador.');
    }
  };

  useEffect(() => {
    if (cameraOn && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraOn]);

  const handleToggleCamera = () => {
    if (cameraOn) stopCamera();
    else startCamera();
  };

  useEffect(() => {
    // Apagar la cámara al salir de la página
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleBack = () => {
    window.location.href = backHref;
  };

  // Overlay OBS (anfitrión o mic): cajita negra con lo actual, nada más.
  if (overlay) {
    const current = previewTrans || previewOrig
      ? { translatedText: previewTrans, originalText: previewOrig }
      : latest;
    return (
      <div className="overlay-root">
        {current && (current.translatedText || current.originalText) ? (
          <div className="overlay-box">
            <div className="overlay-main">
              {tailSentences(current.translatedText || current.originalText || '')}
            </div>
            {current.originalText &&
              current.originalText.trim() !== (current.translatedText ?? '').trim() && (
                <div className="overlay-original">{tailSentences(current.originalText)}</div>
              )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
    {cameraOn && !overlay && (
      <>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="stage-fullscreen-video"
        />
      </>
    )}
    <div className={cameraOn ? 'container mic-overlay' : 'container'}>
      <button
        className="back-fab"
        onClick={handleBack}
        aria-label="Volver a sesiones"
        title="Volver a sesiones"
      >
        <ArrowLeft size={22} />
      </button>

      <div className="top-right-bar">
        <LanguagePicker kind="speak" value={speechLang} onChange={setSpeechLang} />
        <LanguagePicker kind="target" value={targetLang} onChange={setTargetLang} />
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

      <div className="header">
        <h1>{title}</h1>
        <p>
          {connected ? 'Conectado' : 'Conectando...'}
        </p>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {cameraError && <div className="error-message">{cameraError}</div>}
      <button
        onClick={handleToggleCamera}
        className={`cam-fab ${cameraOn ? 'on' : 'off'}`}
        aria-label={cameraOn ? 'Apagar cámara' : 'Activar cámara'}
        title={cameraOn ? 'Apagar cámara' : 'Activar cámara'}
      >
        {cameraOn ? <Video size={26} /> : <VideoOff size={26} />}
      </button>

      <div className="mode-pills" role="group" aria-label="Modo de traducción">
        <span className="mode-cost">{modeCostLabel}</span>
        <button
          className="help-badge"
          aria-label="Cómo funciona la traducción"
          data-tip="Automático: mismo idioma = local gratis sin internet de IA. Idioma cruzado en el mic = Live (~$2.20/h, necesita API key con facturación). Si el Live se cae, se muestra error y se frena."
        >
          <CircleHelp size={22} />
        </button>
      </div>

      <div className="microphone-controls">
        <MicrophoneRecorder
          onTranscript={handleTranscript}
          onInterim={handleInterim}
          isRecording={isRecording}
          onToggleRecording={handleToggleRecording}
          lang={speechLang}
          liveEnabled={liveEnabled}
          onAudioChunk={handleAudioChunk}
          mutedRef={ttsSpeakingRef}
        />
        <button
          onClick={handleToggleTts}
          className={`tts-fab ${ttsAuto ? 'on' : 'off'}`}
          aria-label={ttsAuto ? 'Apagar lectura en voz alta' : 'Activar lectura en voz alta'}
          title={ttsAuto ? 'Apagar lectura en voz alta' : 'Activar lectura en voz alta'}
        >
          {ttsAuto ? <Volume2 size={26} /> : <VolumeX size={26} />}
        </button>
      </div>

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
          !(previewTrans || previewOrig) && (
            <div className="live-placeholder">
              {isRecording
                ? 'Escuchando... Habla para ver la transcripción'
                : 'Inicia la grabación para comenzar la transcripción'}
            </div>
          )
        )}
        {(previewTrans || previewOrig) && (
          <div className="live-next">
            <div className="live-current">
              {previewTrans ? `${tailSentences(previewTrans)}…` : '…'}
            </div>
            {previewOrig && previewOrig.trim() !== previewTrans.trim() && (
              <div className="live-current original">
                {tailSentences(previewOrig)}
              </div>
            )}
          </div>
        )}
      </div>

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
