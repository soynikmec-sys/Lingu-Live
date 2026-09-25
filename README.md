# 🎙️ Lingo Live

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
- **🔊 Lectura en voz alta**: botón parlante que lee cada traducción con voz masculina o voz del sistema.
- **📺 Overlay para OBS**: `?overlay=1` en la URL del viewer = subtítulos en cajita negra listos para quemar en el stream.

---

## 🚀 Cómo usarlo (3 caminos)

| Camino | URL | Para quién | Qué sale |
|---|---|---|---|
| Probar micrófono | `http://localhost:3000/mic` | Vos solo | Transcripción privada |
| Transmitir | `http://localhost:3000/transmitir/room-a` | El speaker | Publica a la sala |
| Ver | `http://localhost:3000/ver/room-a` (botón Ver en la home) | Audiencia | Subtítulos + audio dual opcional |

Salas iniciales: `room-a`, `room-b`. Se pueden crear más desde la home (nombre + idioma).

### ⚡ Quickstart para evaluar (5 min)

```bash
git clone <url-del-repo> lingo-live && cd lingo-live
cd backend && npm install && cp .env.example .env && npm start &
cd ../frontend && npm install && npm run build && npm run start
```

Abrí `http://localhost:3000`, apretá **Probar micrófono** y hablá en español.
Para traducción en vivo ES→EN necesitás la API key (abajo). Para ver una sala con audiencia,
abrí `/transmitir/room-a` en una ventana y `/ver/room-a` en otra.

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

Requisitos: **Node.js ≥ 20** y **Git**. Opcional: cuenta de Google AI Studio (gratis) para el modo Live, Docker para LiveKit.

```bash
# 0. Clonar
git clone <url-del-repo> lingo-live
cd lingo-live

# 1. Backend
cd backend
npm install
cp .env.example .env   # en Windows PowerShell: Copy-Item .env.example .env
npm start              # http://localhost:3003 (GET /health, WS /mic-stream)

# 2. Frontend
cd ../frontend
npm install
npm run build
npm run start          # http://localhost:3000

# Atajo Windows (build + reinicio de ambos en segundo plano):
powershell -NoProfile -File deploy.ps1
```

### 🔑 API key de Gemini (solo para traducción en vivo)

1. Entrá a [Google AI Studio](https://aistudio.google.com) → **Get API key** → creá una key (gratis).
2. Pegala en `backend/.env` como `GEMINI_API_KEY=...` y reiniciá el backend.
3. **Modo Live** (idioma cruzado, ej. ES→EN): necesita la key **con facturación habilitada**
   (~$2.20/hora por sesión activa; poné un Spend Cap en AI Studio).
   Sin facturación verás un error visible en pantalla (nunca falla en silencio).
4. **Sin key** el proyecto anda igual: modo local $0 (mismo idioma) + salas demo.

Variables en `backend/.env` (ver `.env.example`): `GEMINI_API_KEY`, `PORT` (3003),
`SESSION_ROOMS=room-a,room-b`, `TARGET_LANGUAGES=es`, `SESSION_MODE=demo|live`, `GLOSSARY_PATH`.

---

## 📺 Subtítulos en OBS (overlay)

La URL estable por nombre de sala (no se rompe al reiniciar):

1. Hablá transmitiendo en `http://localhost:3000/transmitir/room-a`.
2. En OBS: **Agregar → Fuente de navegador** con esta URL:
   `http://localhost:3000/ver/room-a?overlay=1`
   (también vale `/transmitir/room-a?overlay=1` y `/mic?overlay=1`).
3. En OBS: **Agregar → Fuente de navegador** con esa URL y posicioná la fuente abajo.
4. Salen los subtítulos en cajita negra (traducción grande + original chico), actualizándose solos, con fondo transparente. En silencio se ve transparente (normal).
5. Si ves la página completa en vez de la cajita: te falta el `?overlay=1` al final, o clic derecho en la fuente → Actualizar (OBS cachea).

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

Desarrollado por **Nico** para la Nerdearla Vibeathon 2026, con herramientas abiertas de Google (Gemini Live API).
