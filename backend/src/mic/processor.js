import { GeminiLiveClient } from '../gemini/client.js';

class MicrophoneProcessor {
  constructor() {
    this.geminiClient = null;
    this.isConnected = false;
    this.demoMode = false;
    this.targetLanguage = 'es';
  }

  async initialize() {
    try {
      if (!process.env.GEMINI_API_KEY) {
        // Sin API key: modo demo, eco del texto sin traducción real
        // (igual que SESSION_MODE=demo en las sesiones).
        this.demoMode = true;
        this.isConnected = true;
        console.log('🎤 Procesador de micrófono inicializado en modo demo (sin GEMINI_API_KEY)');
        return;
      }

      this.geminiClient = new GeminiLiveClient(this.targetLanguage);
      // Evitar crash por evento 'error' sin listener en EventEmitter
      this.geminiClient.on('error', (err) => {
        console.error('Error de Gemini en procesador de micrófono:', err?.message || err);
      });
      await this.geminiClient.connect();
      this.isConnected = true;
      console.log('🎤 Procesador de micrófono inicializado con Gemini Live API');
    } catch (error) {
      console.error('Error inicializando procesador de micrófono:', error);
      throw error;
    }
  }

  async processText(text, callback, { targetLang, interim } = {}) {
    if (!this.isConnected) {
      console.warn('Procesador de micrófono no conectado');
      callback({
        type: 'error',
        error: 'Procesador de micrófono no conectado'
      });
      return;
    }

    const lang = targetLang || this.targetLanguage;

    // Modo demo: devolver eco con el formato que espera el frontend
    if (this.demoMode || !this.geminiClient) {
      callback({
        type: 'transcript',
        interim: interim === true,
        originalText: text,
        translatedText: text,
        language: lang,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Cliente efímero por llamada: el cliente compartido + once() por
    // llamada mezcla respuestas cuando dos salas traducen a la vez
    // (el 'transcript' de A disparaba el callback de B y viceversa).
    // connect() no abre red (solo arma el modelo), así que es barato.
    const client = new GeminiLiveClient(lang);

    const cleanup = () => {
      client.removeAllListeners('transcript');
      client.removeAllListeners('error');
      client.disconnect().catch(() => {});
    };

    const onTranscript = (data) => {
      cleanup();
      callback(data);
    };

    const onError = (err) => {
      cleanup();
      callback({
        type: 'error',
        error: err?.message || 'Error de traducción'
      });
    };

    client.once('transcript', onTranscript);
    client.on('error', onError);

    try {
      await client.connect();
      await client.translateText(text, { targetLang: lang, interim });
      // Red de seguridad por si nunca responde
      setTimeout(cleanup, 15000);
    } catch (error) {
      console.error('Error procesando texto con Gemini:', error);
      cleanup();
      callback({
        type: 'error',
        error: error.message
      });
    }
  }

  async disconnect() {
    if (this.geminiClient) {
      await this.geminiClient.disconnect();
      this.geminiClient = null;
    }
    this.isConnected = false;
    this.demoMode = false;
    this.initPromise = null;
    console.log('🎤 Procesador de micrófono desconectado');
  }
}

export const microphoneProcessor = new MicrophoneProcessor();
