import EventEmitter from 'events';
import WebSocket from 'ws';

// Sesión persistente contra Gemini Live Translate.
// A diferencia de GeminiLiveClient (REST, una llamada por frase), acá el
// audio viaja continuo por WebSocket y el modelo devuelve hipótesis
// parciales (interim) + finales con latencia sub-segundo.
//
// Transporte: librería `ws` con el shape exacto del repo oficial
// google-gemini/gemini-live-translate-livekit. Se probó WebSocket nativo
// de Node y el handshake quedaba colgado en silencio (6 timeouts seguidos);
// con `ws` (la que usan el repo oficial y el SDK) la conexión sí anda.
// El SDK (@google/genai) serializa el setup a su manera y el servidor
// ignoraba el translationConfig en silencio: solo transcribía.
//
// Eventos emitidos:
//  - 'connected'                     → sesión lista
//  - 'transcript' {type, interim, originalText, translatedText, language, timestamp}
//  - 'error' err                     → error de la sesión
//  - 'live-unavailable'              → sin key/fondos/permiso/cuota
//  - 'closed'                        → la sesión se cerró

const MODEL = 'gemini-3.5-live-translate-preview';
const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const SETUP_TIMEOUT_MS = 15000;
// Las sesiones solo-audio están limitadas a 15 min (y la conexión ~10 min):
// rotamos antes.
const RECONNECT_MS = 14 * 60 * 1000;

// Detecta errores de facturación/permiso/cuota en las distintas formas
// que los entrega el SDK (Error, CloseEvent, objetos con code/message).
function isBillingError(err) {
  const parts = [];
  if (!err) return false;
  if (typeof err === 'string') parts.push(err);
  if (err.message) parts.push(String(err.message));
  if (err.code) parts.push(String(err.code));
  if (err.reason) parts.push(String(err.reason));
  try {
    parts.push(JSON.stringify(err));
  } catch {
    // err no serializable, usar lo juntado
  }
  const text = parts.join(' ');
  return /PERMISSION_DENIED|BILLING|billing|RESOURCE_EXHAUSTED|QUOTA|quota|429|HTTP 403|status[^0-9]*403/i.test(text);
}

export class LiveTranslateSession extends EventEmitter {
  constructor(targetLang = 'es') {
    super();
    this.targetLang = targetLang;
    this.apiKey = null;
    this.ws = null;
    this.setupDone = false;
    this.connected = false;
    this.closedByUs = false;
    this.reconnectTimer = null;
    this.resumptionHandle = null;
    // Durante rotate() se abre la sesión nueva ANTES de cerrar la vieja:
    // el 'close' de la vieja no debe voltear liveReady en el backend.
    this.suppressNextClose = false;
    this.currentOriginal = '';
    // El Live manda la traducción en pedacitos (streaming de tokens):
    // se acumulan hasta la frase final. Si un mensaje trae el texto
    // completo, el endsWith evita duplicarlo.
    this.liveTranslatedBuffer = '';
    this.shapeLogged = false;
  }

  // Shape exacto probado del repo oficial: translationConfig ADENTRO de
  // generationConfig; transcripciones A NIVEL RAÍZ de setup (anidadas = 1007).
  buildSetup() {
    return {
      setup: {
        model: `models/${MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          translationConfig: {
            targetLanguageCode: this.targetLang,
            echoTargetLanguage: true,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(this.resumptionHandle
          ? { sessionResumption: { handle: this.resumptionHandle } }
          : {}),
      },
    };
  }

  async connect() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY no está configurada');
    }
    this.apiKey = apiKey;
    this.closedByUs = false;
    await this.openSession();

    // Rotación preventiva antes del límite de 15 min
    this.reconnectTimer = setInterval(() => {
      this.rotate().catch((err) => {
        console.error('Error rotando sesión Live:', err?.message || err);
      });
    }, RECONNECT_MS);
  }

  openSession() {
    const setup = this.buildSetup();
    // Diagnóstico: qué config exacta se manda (una vez por sesión).
    console.log('🔧 Live setup:', JSON.stringify(setup).slice(0, 400));
    this.shapeLogged = false;
    this.setupDone = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(() => {
        try { this.ws?.close(); } catch { /* ignorar */ }
        done(reject, new Error('Live setup timeout (15s sin setupComplete)'));
      }, SETUP_TIMEOUT_MS);

      const ws = new WebSocket(`${WS_URL}?key=${this.apiKey}`);
      this.ws = ws;

      ws.on('open', () => {
        console.log('🔌 Live WS abierto, setup enviado');
        ws.send(JSON.stringify(setup));
      });

      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg.setupComplete && !this.setupDone) {
          this.setupDone = true;
          this.connected = true;
          console.log(`🔗 Live Translate conectado (→ ${this.targetLang})`);
          this.emit('connected');
          done(resolve);
          return;
        }
        if (msg.sessionResumptionUpdate?.newHandle) {
          this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
          return;
        }
        if (msg.goAway) {
          console.log(`🔄 Live goAway (${msg.goAway.timeLeft || 'sin tiempo'}): reconectando con resume…`);
          this.reconnectWithResume().catch(() => {});
          return;
        }
        this.handleMessage(msg);
      });

      ws.on('error', (err) => {
        console.error('⚠️ Live WebSocket error:', err?.message || err);
      });

      ws.on('close', (code, reason) => {
        const reasonStr = String(reason || '');
        this.connected = false;
        // Cierre por rotación programada o por close() propio: silencio.
        if (this.suppressNextClose || this.closedByUs) return;
        console.warn(`⚠️ Live WebSocket cerrado (code=${code} reason=${reasonStr.slice(0, 200)})`);
        if (!this.setupDone) {
          const err = new Error(`Live cerrado antes de setup (code=${code} ${reasonStr.slice(0, 150)})`);
          err.code = code;
          if (isBillingError(reasonStr + ' ' + code)) {
            console.warn('⚠️  Live no disponible (facturación/permiso/cuota).');
            this.emit('live-unavailable');
            done(reject, err);
            return;
          }
          done(reject, err);
          return;
        }
        if (isBillingError(reasonStr + ' ' + code)) {
          console.warn('⚠️  Live no disponible (facturación/permiso/cuota).');
          this.emit('live-unavailable');
          return;
        }
        // Caída post-setup: avisar con error duro (el usuario reintenta).
        this.emit('closed');
      });
    });
  }

  // Reconexión con resume handle ante goAway.
  async reconnectWithResume() {
    if (this.closedByUs) return;
    console.log('🔄 Live reconectando con resume…');
    this.suppressNextClose = true;
    const old = this.ws;
    try {
      await this.openSession();
    } catch (err) {
      console.error('Error en resume Live:', err?.message || err);
      this.emit('closed');
      return;
    } finally {
      try { old?.close(); } catch { /* ignorar */ }
      this.suppressNextClose = false;
    }
  }

  // Abre la sesión nueva antes de cerrar la vieja para no cortar el audio.
  // Si el open falla, no se toca la vieja (su propio onclose avisará).
  async rotate() {
    if (!this.apiKey) return;
    console.log('🔄 Rotando sesión Live Translate...');
    const old = this.ws;
    await this.openSession();
    this.suppressNextClose = true;
    try {
      old?.close();
    } catch {
      // la sesión vieja ya estaba cerrada, no pasa nada
    } finally {
      this.suppressNextClose = false;
    }
  }

  sendAudio(base64Pcm) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupDone) return;
    try {
      this.ws.send(JSON.stringify({
        realtimeInput: {
          audio: { data: base64Pcm, mimeType: 'audio/pcm;rate=16000' },
        },
      }));
    } catch {
      // socket muriendo: el onclose avisará
    }
  }

  setTargetLang(lang) {
    // El modelo de traducción fija el idioma por sesión: si cambia,
    // se rota la sesión para aplicar el nuevo destino.
    if (lang && lang !== this.targetLang) {
      this.targetLang = lang;
      this.rotate().catch((err) => {
        console.error('Error cambiando idioma Live:', err?.message || err);
      });
    }
  }

  handleMessage(msg) {
    // serverContent puede venir directo o envuelto según versión
    const sc = msg?.serverContent ?? msg?.data?.serverContent;
    if (!sc) return;

    // Diagnóstico (una vez por sesión): qué campos trae realmente el
    // servidor + histograma de formas (cada 50 mensajes).
    const shape = Object.keys(sc).sort().join('+') || '(vacío)';
    this.shapeCount = this.shapeCount || {};
    this.shapeCount[shape] = (this.shapeCount[shape] || 0) + 1;
    this.shapeTotal = (this.shapeTotal || 0) + 1;
    if (!this.shapeLogged) {
      this.shapeLogged = true;
      const snap = (o) => (o && typeof o === 'object'
        ? `{${Object.keys(o).join(',')}}:${JSON.stringify(o.text ?? o.finished ?? '').slice(0, 60)}`
        : String(o));
      console.log('🔍 Live serverContent keys:', Object.keys(sc).join(','),
        '| interim:', snap(sc.interimInputTranscription),
        '| input:', snap(sc.inputTranscription),
        '| output:', snap(sc.outputTranscription),
        '| turnComplete:', sc.turnComplete);
    } else if (this.shapeTotal % 50 === 0) {
      console.log('📊 Live shapes:', JSON.stringify(this.shapeCount));
    }

    const now = () => new Date().toISOString();
    // El original es "sticky": input y output viajan en mensajes
    // separados (el histograma lo probó: jamás viene interimInput).
    // Cada mensaje de output emite original:'' y borraba el gris que
    // había puesto el input. Se conserva el último original conocido
    // y solo se resetea al commitear el final (borde de turno).
    const emitPreview = () => {
      this.emit('transcript', {
        type: 'transcript',
        source: 'live-audio',
        interim: true,
        originalText: this.currentOriginal,
        translatedText: this.liveTranslatedBuffer,
        language: this.targetLang,
        timestamp: now(),
      });
    };
    const emitFinal = (translated) => {
      this.emit('transcript', {
        type: 'transcript',
        source: 'live-audio',
        interim: false,
        originalText: this.currentOriginal,
        translatedText: translated,
        language: this.targetLang,
        timestamp: now(),
      });
      this.currentOriginal = '';
      this.liveTranslatedBuffer = '';
    };
    const appendOutput = (chunk) => {
      if (chunk && !this.liveTranslatedBuffer.endsWith(chunk)) {
        this.liveTranslatedBuffer +=
          (this.liveTranslatedBuffer && !this.liveTranslatedBuffer.endsWith(' ') ? ' ' : '') + chunk;
      }
    };

    // Lógica espejo del repo oficial: el output vive su propio ciclo
    // (interim → final por turnComplete), independiente del input.
    if (typeof sc.outputTranscription?.text === 'string' && sc.outputTranscription.text) {
      appendOutput(sc.outputTranscription.text);
      if (sc.turnComplete === true) {
        emitFinal(this.liveTranslatedBuffer);
        return;
      }
      emitPreview();
    }
    if (typeof sc.interimInputTranscription?.text === 'string' && sc.interimInputTranscription.text) {
      this.currentOriginal = sc.interimInputTranscription.text;
      emitPreview();
    }
    if (typeof sc.inputTranscription?.text === 'string' && sc.inputTranscription.text) {
      this.currentOriginal = sc.inputTranscription.text;
      if (sc.turnComplete === true && this.liveTranslatedBuffer) {
        emitFinal(this.liveTranslatedBuffer);
        return;
      }
      emitPreview();
    }
    // Cierre de turno sin output nuevo pero con buffer pendiente:
    // se commitea lo acumulado (igual que el oficial).
    if (sc.turnComplete === true && this.liveTranslatedBuffer) {
      emitFinal(this.liveTranslatedBuffer);
    }
  }

  async close() {
    this.closedByUs = true;
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      // ignorar errores al cerrar
    }
    this.ws = null;
    this.connected = false;
    this.setupDone = false;
  }
}
