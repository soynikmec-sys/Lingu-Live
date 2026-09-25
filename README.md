# 🎙️ LiveCast Translate — lingu-connect

Transcripción y traducción simultánea en tiempo real para conferencias, con soporte para múltiples sesiones en paralelo.

Proyecto para la **Nerdearla Vibeathon 2026** (24-25 de septiembre de 2026).
🔗 Desafío: https://nerdearla26.devpost.com/

> **English summary:** real-time live transcription + translation for conferences. Speak into the mic (or broadcast to a room) and the audience reads live subtitles in their language, with optional spoken audio. Open source (MIT), built on Gemini Live API + LiveKit-ready design.

🎥 **Video demo (1-2 min):** _(link de YouTube acá antes del submit — grabar con audio real y subtítulos en inglés generados por el propio proyecto)_

---

## 📋 Índice

- [Qué hace](#-qué-hace)
- [Cómo usarlo (3 caminos)](#-cómo-usarlo-3-caminos)
- [Modos y costos](#-modos-y-costos)
- [Instalación y puesta en marcha](#-instalación-y-puesta-en-marcha)
- [Variables de entorno](#-variables-de-entorno)
- [Subtítulos en OBS (overlay)](#-subtítulos-en-obs-overlay)
- [Cómo escalar a más sesiones](#-cómo-escalar-a-más-sesiones)
- [Stack y arquitectura](#-stack-y-arquitectura)
- [Licencia](#-licencia)

---

## 💡 Qué hace

- **🎤 Probar micrófono** (`/mic`): transcribís en privado, solo lo ves vos.
- **📡 Transmitir** (`/transmitir/[room]`): lo que hablás se publica en vivo a la sala.
- **👁️ Ver** (`/[sessionId]`): la audiencia lee subtítulos en tiempo real (texto + opcionalmente audio original y traducido).
- **➕ Crear salas** desde la home con nombre e idioma (si hay alguien transmitiendo, el botón se apaga y solo se puede ver).
- **🌍 35 idiomas** con buscador (ES/EN fijos arriba): hablás en uno, se traduce a otro.
- **🔊 Lectura en voz alta**: botón parlante que lee cada traducción con voz masculina (edge-tts, gratis) o voz del sistema.
- **📺 Overlay para OBS**: `?overlay=1` en la URL del viewer = subtítulos en cajita negra listos para quemar en el stream.

---

## 🚀 Cómo usarlo (3 caminos)

| Camino | URL | Para quién | Qué sale |
|---|---|---|---|
| Probar micrófono | `http://localhost:3000/mic` | Vos solo | Transcripción privada |
| Transmitir | `http://localhost:3000/transmitir/room-a` | El speaker | Publica a la sala |
| Ver | `http://localhost:3000/[sessionId]` (botón Ver en la home) | Audiencia | Subtítulos + audio dual opcional |

Salas iniciales: `room-a`, `room-b`. Se pueden crear más desde la home.

---

## 🎚️ Modos y costos

El modo es **automático**, sin opciones manuales:

| Situación | Modo | Qué necesita | Costo |
|---|---|---|---|
| Mismo idioma (ej. ES→ES) | Local | Nada (Web Speech del navegador) | **$0** |
| Idioma cruzado en mic/transmitir | Live (Gemini `gemini-3.5-live-translate-preview`) | API key de AI Studio con facturación | **~$2.20/hora** por sesión activa |
| Salas (viewers) | Texto publicado + audio | Lo mismo que el transmisor | Según el transmisor |

- Sin API key no hay Live: se muestra error visible (nunca falla en silencio).
- Recomendado: ponerle **Spend Cap** al proyecto en AI Studio.
- Las sesiones Live de solo-audio rotan solas cada ~14 min (límite de 15 min del modelo).

---

## 🛠️ Instalación y puesta en marcha

Requisitos: **Node.js ≥ 20**. Opcional: cuenta de Google AI Studio (gratis) para el modo Live, Docker para LiveKit.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env   # completar GEMINI_API_KEY para modo Live
npm start              # http://localhost:3003 (GET /health, WS /mic-stream)

# 2. Frontend
cd ../frontend
npm install
npm run build
npm run start          # http://localhost:3000

# Atajo Windows (build + reinicio de ambos en segundo plano):
powershell -NoProfile -File deploy.ps1
```

Variables en `backend/.env` (ver `.env.example`): `GEMINI_API_KEY`, `PORT` (default 3003 en deploy),
`SESSION_ROOMS=room-a,room-b`, `TARGET_LANGUAGES=es`, `SESSION_MODE=demo|live`, `GLOSSARY_PATH`.

Sin `GEMINI_API_KEY` el proyecto anda igual en modo local/demo (mismo idioma + salas de ejemplo).

---

## 📺 Subtítulos en OBS (overlay)

1. Abrí la sala como viewer y copiá la URL agregando `?overlay=1`:
   `http://localhost:3000/<sessionId>?overlay=1`
2. En OBS: **Agregar → Fuente de navegador** → pegá la URL.
3. Tamaño sugerido: **1920×250**, posicionada abajo (franja inferior).
4. Salen los subtítulos en cajita negra (traducción grande + original chico), actualizándose solos, con fondo transparente.

---

## 📈 Cómo escalar a más sesiones

- Agregar una room a `SESSION_ROOMS` en `backend/.env` = nueva sesión sin tocar código (ej. `room-a,room-b,room-c`).
- Cada sala es independiente: su WS, su sesión Live y su audiencia.
- Cuello de botella real: cuota de Gemini (free tier: 3-5 WS concurrentes) y CPU/RAM. Para 10+ sesiones en producción: LiveKit + balanceo + keys con facturación (ver `docs/` y comentarios en `backend/src/sessions/manager.js`).

---

## 🏗️ Stack y arquitectura

```
[Mic / Cámara] → [Web Speech local | Gemini Live API] → [Backend Fastify + WS]
                                                                       ↓
                                              Audiencia (Next.js + subtítulos + audio dual)
```

| Capa | Tecnología | Costo |
|---|---|---|
| ASR + Traducción live | Gemini Live API (`gemini-3.5-live-translate-preview`) | Gratis (tier AI Studio) / ~$2.20/h pago |
| ASR local / Texto | Web Speech API + Gemini REST | $0 / centavos por frase |
| Backend / distribución | Node.js 20 + Fastify + WebSocket | Gratis |
| Vista de audiencia | Next.js | Gratis |
| Voz de lectura | edge-tts (voces masculinas) + voz del sistema | Gratis |
| Streaming de audio (futuro) | LiveKit (diseño listo, migración pendiente) | Gratis self-hosted |

Glosario técnico: `glossary.json` (inyectado como contexto). Verificar con `npm run check:glossary` en `backend/`.

---

## 📜 Licencia

**MIT** — ver `LICENSE`. Cumple el requisito de licencia OSI-aprobada del desafío.

## 🙌 Créditos

Desarrollado por **Nico** para la Nerdearla Vibeathon 2026, con herramientas abiertas de Google (Gemini Live API) y MediaPipe como referencia.
