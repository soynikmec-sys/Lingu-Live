'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff } from 'lucide-react';

interface MicrophoneRecorderProps {
  onTranscript: (text: string) => void;
  onInterim?: (text: string) => void;
  isRecording: boolean;
  onToggleRecording: () => void;
  lang?: string;
  // Modo live: en vez de Web Speech API se manda audio PCM crudo
  // (base64, 16kHz) para traducción en streaming vía Gemini Live API.
  liveEnabled?: boolean;
  onAudioChunk?: (base64Pcm: string) => void;
  // Anti-eco TTS: mientras está en true se ignoran resultados (el mic
  // escucharía al parlante). Lo maneja el padre con mute + cooldown.
  mutedRef?: React.RefObject<boolean>;
}

export default function MicrophoneRecorder({
  onTranscript,
  onInterim,
  isRecording,
  onToggleRecording,
  lang,
  liveEnabled,
  onAudioChunk,
  mutedRef
}: MicrophoneRecorderProps) {
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const liveAudioRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioWorkletNode } | null>(null);
  // Espejo en ref para que los callbacks de la API (onend) vean el valor
  // actual y no el capturado en el closure al crear el recognition.
  const isRecordingRef = useRef(isRecording);
  isRecordingRef.current = isRecording;
  const langRef = useRef(lang ?? (typeof navigator !== 'undefined' && navigator.language) ?? 'es-ES');
  langRef.current = lang ?? (typeof navigator !== 'undefined' && navigator.language) ?? 'es-ES';
  const liveEnabledRef = useRef(liveEnabled);
  liveEnabledRef.current = liveEnabled;
  const onAudioChunkRef = useRef(onAudioChunk);
  onAudioChunkRef.current = onAudioChunk;
  // Guardia de generación: al cambiar de modo con el mic abierto, el
  // recognition viejo se reintentaba solo (onend → restart) y quedaban DOS
  // pipelines vivos (texto + live) traduciendo a la vez. Con este flag el
  // stop es definitivo hasta el próximo start.
  const stopRequestedRef = useRef(false);

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Captura PCM 16-bit 16kHz en chunks (~128ms) para streaming al Live API
  const startLiveAudio = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    const ctx = new AudioContext({ sampleRate: 16000 });
    // Chrome suele dejar el contexto en 'suspended' fuera del gesto directo:
    // sin resume el worklet no emite audio real (UI dice "Escuchando" igual).
    console.log('🎤 AudioContext state:', ctx.state, 'sampleRate:', ctx.sampleRate);
    if (ctx.state === 'suspended') {
      await ctx.resume();
      console.log('🎤 AudioContext tras resume:', ctx.state);
    }
    const source = ctx.createMediaStreamSource(stream);

    const workletCode = `
      class PcmCapture extends AudioWorkletProcessor {
        buffer = new Int16Array(2048);
        idx = 0;
        process(inputs) {
          const ch = inputs[0]?.[0];
          if (!ch) return true;
          for (let i = 0; i < ch.length; i++) {
            const v = Math.max(-1, Math.min(1, ch[i]));
            this.buffer[this.idx++] = v < 0 ? v * 32768 : v * 32767;
            if (this.idx >= this.buffer.length) {
              const out = this.buffer.slice(0, this.idx);
              this.port.postMessage({ buffer: out.buffer }, [out.buffer]);
              this.idx = 0;
            }
          }
          return true;
        }
      }
      registerProcessor('pcm-capture', PcmCapture);
    `;
    const url = URL.createObjectURL(new Blob([workletCode], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);

    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    let chunkCount = 0;
    node.port.onmessage = (ev: MessageEvent) => {
      if (!ev.data?.buffer) return;
      chunkCount++;
      // Evidencia de flujo: 1er chunk + cada 100 (~13s). Si ves el 1 pero
      // nunca más, el worklet se frenó; si no ves ni el 1, no hay audio.
      if (chunkCount === 1) console.log('🎤 PCM chunk #1, bytes:', ev.data.buffer.byteLength);
      else if (chunkCount % 100 === 0) console.log(`🎤 PCM chunks: ${chunkCount}`);
      onAudioChunkRef.current?.(arrayBufferToBase64(ev.data.buffer));
    };
    // Mantener el grafo vivo sin sonar: ganancia cero a destino
    const zero = ctx.createGain();
    zero.gain.value = 0;
    source.connect(node);
    node.connect(zero);
    zero.connect(ctx.destination);

    liveAudioRef.current = { ctx, stream, node };
    setIsListening(true);
    setPermissionError(null);
    console.log('🎤 Streaming de audio live iniciado (PCM 16kHz)');
  };

  const stopLiveAudio = () => {
    const live = liveAudioRef.current;
    if (live) {
      try {
        live.node.disconnect();
        live.stream.getTracks().forEach(t => t.stop());
        live.ctx.close();
      } catch (e) {
        console.error('Error cerrando audio live:', e);
      }
      liveAudioRef.current = null;
    }
    setIsListening(false);
  };

  const startRecording = async () => {
    stopRequestedRef.current = false;
    try {
      // Modo live: audio crudo al backend, sin Web Speech API
      if (liveEnabledRef.current) {
        await startLiveAudio();
        return;
      }

      // Primero verificar que el micrófono funcione
      console.log('🎤 Verificando acceso al micrófono...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      console.log('🎤 Micrófono accesible, stream obtenido');

      // Verificar que haya tracks de audio
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        setPermissionError('No se encontraron tracks de audio en el stream.');
        return;
      }
      console.log('🎤 Tracks de audio encontrados:', audioTracks.length);

      // No necesitamos mantener el stream abierto, el reconocimiento lo manejará
      stream.getTracks().forEach(track => track.stop());

      // Usar Web Speech API para transcripción local
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      console.log('🎤 SpeechRecognition disponible:', !!SpeechRecognition);
      
      if (!SpeechRecognition) {
        setPermissionError('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
        return;
      }

      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = langRef.current;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        // Anti-eco TTS: ignorar todo mientras habla el parlante.
        if (mutedRef?.current) return;
        console.log('🎤 Resultado de reconocimiento:', event);
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          console.log(`🎤 Transcript[${i}]:`, transcript, 'Final:', event.results[i].isFinal);

          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        // Solo los resultados finales viajan al backend (traducción).
        // Los parciales son preview local: dar sensación de tiempo real
        // sin traducir frases a medio formar.
        // Ojo stop-race: los finales tardíos valen aunque ya se haya
        // frenado (llegan después del stop); los interim tardíos no.
        if (finalTranscript) {
          console.log('🎤 Enviando transcript final:', finalTranscript);
          onInterim?.('');
          onTranscript(finalTranscript);
        } else if (interimTranscript && !stopRequestedRef.current) {
          onInterim?.(interimTranscript);
        }
      };
      
      recognition.onstart = () => {
        setIsListening(true);
        console.log('🎤 Reconocimiento de voz iniciado');
      };
      
      recognition.onend = () => {
        setIsListening(false);
        console.log('🎤 Reconocimiento de voz detenido');

        if (isRecordingRef.current) {
          // Reiniciar si sigue grabando (se usa el ref, no el closure).
          // Si hubo un stop (p.ej. cambio de modo texto→live), no revivir.
          console.log('🎤 Reiniciando reconocimiento...');
          setTimeout(() => {
            if (!isRecordingRef.current || stopRequestedRef.current) return;
            try {
              recognition.start();
            } catch (e) {
              console.error('Error reiniciando:', e);
            }
          }, 100);
        }
      };
      
      recognition.onerror = (event: any) => {
        console.error('Error en reconocimiento de voz:', event.error);
        
        if (event.error === 'not-allowed') {
          setPermissionError('No se pudo acceder al micrófono. Verifica los permisos.');
        } else if (event.error === 'no-speech') {
          // No hacer nada, es normal cuando hay silencio
          console.log('Silencio detectado, continuando escucha...');
        } else if (event.error === 'audio-capture') {
          setPermissionError('No se detectó audio. Verifica tu micrófono.');
        } else if (event.error === 'network') {
          setPermissionError('Error de red en el reconocimiento de voz.');
        }
      };
      
      recognition.start();
      setPermissionError(null);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      setPermissionError('No se pudo acceder al micrófono. Verifica los permisos.');
    }
  };

  const stopRecording = () => {
    stopRequestedRef.current = true;
    stopLiveAudio();
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  useEffect(() => {
    if (isRecording) {
      startRecording();
    } else {
      stopRecording();
    }

    return () => {
      stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, liveEnabled]);

  return (
    <div className="microphone-recorder">
      {permissionError && (
        <div className="error-message">
          {permissionError}
        </div>
      )}

      {isRecording && (
        <div className="recording-indicator">
          <span className="recording-dot"></span>
          {isListening ? '🎧 Escuchando...' : '⏳ Iniciando...'}
        </div>
      )}

      <button
        onClick={onToggleRecording}
        className={`mic-fab ${isRecording ? 'active' : 'muted'}`}
        disabled={!!permissionError}
        aria-label={isRecording ? 'Detener grabación' : 'Iniciar grabación'}
        title={isRecording ? 'Detener grabación' : 'Iniciar grabación'}
      >
        {isRecording ? <Mic size={32} /> : <MicOff size={32} />}
      </button>
    </div>
  );
}
