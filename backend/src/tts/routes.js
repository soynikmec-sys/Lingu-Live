import { createHash } from 'crypto';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EdgeTTS } from 'node-edge-tts';

// Voces masculinas de Edge por idioma (mismo criterio que Centralix:
// default es-AR-TomasNeural). Gratis, sin API key.
const MALE_VOICES = {
  es: 'es-AR-TomasNeural',
  en: 'en-US-ChristopherNeural',
  pt: 'pt-BR-AntonioNeural',
  zh: 'zh-CN-YunxiNeural',
  fr: 'fr-FR-HenriNeural',
  de: 'de-DE-ConradNeural',
  it: 'it-IT-DiegoNeural',
  ja: 'ja-JP-KeitaNeural',
  ko: 'ko-KR-InJoonNeural',
  ar: 'ar-SA-HamedNeural',
  hi: 'hi-IN-MadhurNeural',
  ru: 'ru-RU-DmitryNeural',
  nl: 'nl-NL-MaartenNeural',
};
const DEFAULT_VOICE = 'es-AR-TomasNeural';

const CACHE_DIR = join(tmpdir(), 'opencode', 'tts-cache');
mkdirSync(CACHE_DIR, { recursive: true });

const voiceFor = (lang) => {
  const prefix = String(lang || '').split('-')[0].toLowerCase();
  return MALE_VOICES[prefix] || DEFAULT_VOICE;
};

export async function registerTtsRoutes(fastify) {
  // POST /tts { text, lang } → audio/mpeg (MP3). Con caché por hash:
  // las frases repetidas no pegan a Microsoft de nuevo.
  fastify.post('/tts', async (request, reply) => {
    const { text, lang } = request.body || {};
    const clean = String(text || '').trim().slice(0, 500);
    if (!clean) {
      return reply.code(400).send({ error: 'Texto vacío' });
    }
    const voice = voiceFor(lang);
    const hash = createHash('sha1').update(`${voice}:${clean}`).digest('hex');
    const file = join(CACHE_DIR, `${hash}.mp3`);

    try {
      if (!existsSync(file)) {
        const started = Date.now();
        const tts = new EdgeTTS({ voice, lang: voice.split('-').slice(0, 2).join('-') });
        await tts.ttsPromise(clean, file);
        console.log(`🔊 TTS listo en ${Date.now() - started}ms (${voice}, ${clean.length} chars)`);
      }
      const buf = readFileSync(file);
      return reply.header('Content-Type', 'audio/mpeg').send(buf);
    } catch (err) {
      console.error('Error generando TTS:', err?.message || err);
      return reply.code(502).send({ error: 'TTS no disponible' });
    }
  });
}
