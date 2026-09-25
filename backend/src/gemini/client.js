import { GoogleGenerativeAI } from '@google/generative-ai';
import EventEmitter from 'events';

export class GeminiLiveClient extends EventEmitter {
  constructor(targetLanguage = 'es', glossary = null) {
    super();
    this.targetLanguage = targetLanguage;
    this.glossary = glossary;
    this.apiKey = process.env.GEMINI_API_KEY;
    this.isConnected = false;
    this.client = null;
    this.model = null;
  }

  async connect() {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY no está configurada');
    }

    try {
      this.client = new GoogleGenerativeAI(this.apiKey);
      
      // Usar modelo que verificamos que funciona con la API key
      this.model = this.client.getGenerativeModel({ 
        model: 'gemini-flash-latest' 
      });
      
      this.isConnected = true;
      this.emit('connected');
      console.log('🔗 Conectado a Gemini API (gemini-flash-latest)');
    } catch (error) {
      console.error('Error conectando a Gemini:', error);
      throw error;
    }
  }

  async translateText(text, { targetLang, interim } = {}) {
    if (!this.isConnected || !this.model) {
      console.warn('⚠️  Cliente Gemini no conectado');
      return;
    }

    const lang = targetLang || this.targetLanguage;

    try {
      // Construir el prompt con instrucciones de traducción
      let prompt = `Translate the following text to ${lang}. Return only the translated text without any additional explanation or formatting: "${text}"`;
      
      if (this.glossary && Object.keys(this.glossary).length > 0) {
        prompt += '\n\nUse this technical glossary for context:\n';
        for (const [term, definition] of Object.entries(this.glossary)) {
          prompt += `- ${term}: ${definition}\n`;
        }
      }

      // Enviar texto a Gemini para traducción (con 1 reintento ante
      // fallos de red transitorios: bajo ráfagas de interim+final
      // undici a veces tira "fetch failed" aunque la red anda).
      let lastError = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const result = await this.model.generateContent(prompt);
          const response = await result.response;
          const translatedText = response.text();
          
          // Emitir transcripción (con `type` para que el frontend la reconozca;
          // `interim: true` = traducción parcial en vivo, no va al historial)
          this.emit('transcript', {
            type: 'transcript',
            interim: interim === true,
            originalText: text,
            translatedText: translatedText,
            language: lang,
            timestamp: new Date().toISOString()
          });
          return;
        } catch (err) {
          lastError = err;
          const msg = String(err?.message || '');
          const retryable = /fetch failed|ETIMEDOUT|ECONNRESET|EAI_AGAIN|429/.test(msg);
          if (retryable && attempt === 1) {
            await new Promise(r => setTimeout(r, 600));
            continue;
          }
          throw err;
        }
      }
      throw lastError;
    } catch (error) {
      console.error('Error traduciendo texto con Gemini:', error);
      this.emit('error', error);
    }
  }

  async disconnect() {
    this.isConnected = false;
    this.emit('disconnected');
    console.log('🔌 Desconectado de Gemini API');
  }
}
