# 🎙️ LiveCast Translate

Transcripción y traducción simultánea en tiempo real para conferencias, con soporte para múltiples sesiones en paralelo.

Proyecto desarrollado para la **Nerdearla Vibeathon 2026** (24-25 de septiembre de 2026).

🔗 Desafío: https://nerdearla26.devpost.com/

---

## 📋 Índice

- [El problema](#-el-problema)
- [Solución propuesta](#-solución-propuesta)
- [Stack tecnológico](#-stack-tecnológico)
- [Arquitectura](#-arquitectura-resumen)
- [Requisitos](#-requisitos)
- [Instalación y puesta en marcha](#-instalación-y-puesta-en-marcha)
- [Variables de entorno](#-variables-de-entorno)
- [Cómo escalar a más sesiones](#-cómo-escalar-a-más-sesiones)
- [MVP vs Extras](#-mvp-vs-extras)
- [Estructura del repo](#-estructura-del-repo)
- [Licencia](#-licencia)
- [Créditos](#-créditos)

---

## 🎯 El problema

Las conferencias tipo Nerdearla necesitan subtitulado y traducción en vivo para varias charlas en paralelo. Hoy esto se resuelve con:

- Herramientas comerciales de interpretación simultánea (caras, requieren intérpretes humanos).
- Soluciones manuales que no escalan a múltiples escenarios a la vez.

**LiveCast Translate** busca reemplazar ese esquema con una solución open source que resuelva, concretamente:

1. **Captura de audio en vivo** de una charla (micrófono, streaming o archivo).
2. **Transcripción en tiempo real** en el idioma original en el que se habla.
3. **Traducción** de esa transcripción a español (y opcionalmente inglés → español y viceversa).
4. **Distribución en tiempo real** de esos subtítulos, con latencia baja, a cada espectador conectado.
5. **Escalado a varios escenarios simultáneos** (mínimo 2 sesiones, pensado para 5-10+) sin duplicar infraestructura a mano.
6. **Interfaz de audiencia** donde cada persona elige sesión e idioma sin fricción.
7. **Reproducibilidad y facilidad de despliegue**: cualquiera tiene que poder levantar el proyecto siguiendo este README, sin licencias pagas obligatorias ni pasos ocultos.

---

## 🏆 Criterios de evaluación del desafío

El jurado (Nerdearla, Google DeepMind y Cline) va a evaluar el proyecto según:

|| Criterio | Cómo lo cubrimos |
||---|---|
|| Calidad de transcripción | Gemini Live API con detección automática de idioma + glosario técnico opcional como contexto |
|| Latencia | Conexión WebSocket directa por sesión, sin pasos intermedios innecesarios |
|| Escalabilidad | Una room de LiveKit + una conexión Live API por sesión, aislada del resto |
|| Facilidad de despliegue/operación | Stack 100% gratuito para levantar (tier gratis de AI Studio + LiveKit self-hosted), documentado paso a paso en este README |
|| Innovación | Arquitectura modular que permite escalar horizontalmente sin cambios de código |

---

## 💡 Solución propuesta

Un pipeline de tres capas:

```
[Audio en vivo] → [ASR + Traducción] → [Distribución en tiempo real] → [Vista de audiencia]
```

- La **captura y el streaming de audio** se maneja con LiveKit, que también resuelve la parte de "múltiples salas" de forma nativa (cada sala = una sesión/charla).
- El **ASR (speech-to-text) y la traducción** se hacen con la Gemini Live API de Google, conectada por WebSocket a cada sala.
- La **distribución** a la audiencia se hace por WebSocket/SSE desde un backend liviano, con un modelo pub/sub por sala: cualquier cantidad de espectadores puede suscribirse a la misma sesión sin abrir conexiones nuevas a Gemini (no es un requisito explícito del desafío, pero es necesario para que la vista de audiencia funcione con más de una persona a la vez).
- La **vista de audiencia** es una app Next.js donde cada usuario elige sala e idioma.

---

## 🛠️ Stack tecnológico

|| Capa | Tecnología | Costo | Open source | Por qué |
||---|---|---|---|---|
|| Captura/streaming de audio | **LiveKit** | Gratis (self-hosted) | ✅ Sí (Apache 2.0) | Maneja WebRTC, salas y reconexión sin reinventar la rueda. |
|| ASR + Traducción | **Gemini Live API** (`gemini-3.5-live-translate-preview`) | Gratis con tier de AI Studio (cuota diaria); pago por token si se escala | ❌ No (servicio de Google) | Sugerido por el propio desafío/sponsor (Google DeepMind). Resuelve ASR + traducción EN→ES en un solo servicio, sub-segundo de latencia. |
|| Backend / distribución | **Node.js 20+ (Fastify)** | Gratis | ✅ Sí | Reparte los subtítulos por WebSocket a cada cliente conectado. |
|| Vista de audiencia | **Next.js** | Gratis | ✅ Sí | Selector de sala + idioma, subtítulos en vivo. |

> **Nota sobre licencias:** el requisito del desafío pide que *el código del proyecto* tenga licencia OSI-aprobada (ver [Licencia](#-licencia)). Consumir la Gemini Live API como servicio no entra en conflicto con eso — es análogo a llamar a cualquier API externa desde un proyecto open source.

---

## 🏗️ Arquitectura (resumen)

```
Audiencia (Next.js) 
   ↕ WebSocket
Backend de distribución (Fastify)
   ↕ WebSocket
LiveKit (una room por sesión/charla)
   ↕ audio stream
Gemini Live API (ASR + traducción, una conexión por room)
```

Cada sesión/charla corre de forma aislada: su propia room de LiveKit + su propia conexión al Live API. Esto es lo que permite escalar horizontalmente sin tocar código (ver más abajo).

*(Diagrama visual detallado disponible en la conversación del hackathon; se puede exportar a `docs/architecture.png` antes de la entrega.)*

---

## ✅ Requisitos

- Node.js ≥ 20 (único runtime del stack; no hay mitad Python)
- Cuenta de Google AI Studio con API key de Gemini (gratis) → https://aistudio.google.com (solo para modo live; el modo demo no necesita clave)
- LiveKit: Docker para self-host local (primario), o LiveKit Cloud en su tier gratis como contingencia
- Un archivo de audio o stream de charla real para la demo: `demo/audio-sample.wav` incluido, o charlas públicas de Nerdearla en YouTube

---

## 🚀 Instalación y puesta en marcha

```bash
# 1. Clonar el repo
git clone https://github.com/<usuario>/livecast-translate.git
cd livecast-translate

# 2. Backend
cd backend
npm install
cp .env.example .env   # completar GEMINI_API_KEY solo para modo live; demo funciona sin clave
npm run dev            # http://localhost:3001 (GET /health, GET /sessions, WS /stream/:sessionId)

# 3. LiveKit (local, vía Docker)
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev

# 4. Frontend (vista de audiencia)
cd ../frontend
npm install
npm run dev
```

La app de audiencia queda disponible en `http://localhost:3002` (o `http://localhost:3000` si está disponible), con un selector de sala e idioma.

## 🎤 Modo Micrófono Directo

El proyecto incluye un modo para transcribir directamente desde tu micrófono:

1. En la página principal, haz clic en "🎤 Transcribir desde Micrófono"
2. Otorga permisos de acceso al micrófono cuando el navegador lo solicite
3. Haz clic en "🎤 Iniciar Grabación" para comenzar
4. Habla y verás la transcripción en tiempo real

**Para usar IA real (Gemini Live API):**
1. Configura tu API key de Google AI Studio en `backend/.env`:
   ```env
   GEMINI_API_KEY=tu_api_key_real
   SESSION_MODE=live
   ```
2. Reinicia el backend
3. El sistema usará Gemini para transcribir y traducir tu voz en tiempo real

**Sin API key (modo demo):**
- El sistema simulará transcripciones de demostración
- Útil para probar la interfaz sin configurar servicios externos

## 🎚️ Modos y costos (página `/mic`)

La página del micrófono tiene tres modos de traducción (selector Auto/Texto/Live):

| Modo | Qué hace | Qué necesita | Costo aprox. |
|---|---|---|---|
| Local | Mismo idioma hablado y visto: muestra directo sin llamar a IA | Nada | $0 |
| Texto (plan A) | Web Speech API + Gemini REST por frases | API key de AI Studio (tier gratis) | $0 dentro del gratis; ~$0.50–1.30/hora en pago |
| Live (plan B) | Audio continuo a Gemini Live API (`gemini-3.5-live-translate-preview`), latencia sub-segundo | API key + facturación habilitada | ~$2.20/hora por sesión |

**Por defecto funciona con el plan B pago, pero si no hay fondos cae solo al plan A:**
- En `Auto` (default) prueba Live y, si no hay API key, facturación o cuota, muestra un aviso abajo a la izquierda y sigue en modo texto gratis.
- En `Texto` fuerza el plan A. En `Live` fuerza el plan B (si no hay fondos, igual cae a texto con aviso).
- Las sesiones Live de solo-audio duran 15 min: el backend las rota solo cada 14 min.

---

## 🔐 Variables de entorno

```env
# backend/.env (copiar desde backend/.env.example)
GEMINI_API_KEY=tu_api_key_de_ai_studio   # requerida solo en modo live; si está vacío usa modo demo
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
TARGET_LANGUAGES=es
SESSION_ROOMS=room-a,room-b              # agregar una room = agregar una sesión, sin código nuevo
SESSION_MODE=demo                        # demo = transports stub, sin claves; live = Gemini + LiveKit reales
GLOSSARY_PATH=../glossary.json          # ruta al glosario (relativo a backend/)
PORT=3001
```

---

## 📈 Cómo escalar a más sesiones

El diseño está pensado para que agregar una sesión sea configuración, no código nuevo:

1. Se crea una nueva room en LiveKit por cada charla/escenario.
2. Se agrega la room a `SESSION_ROOMS` en `backend/.env` (ej. `SESSION_ROOMS=room-a,room-b,room-c`): el backend abre un worker con su propia conexión al Live API por cada room, sin tocar código.
3. La app de audiencia simplemente lista las rooms activas — no hace falta redeploy.

Para ir más allá de 10 sesiones en producción, el cuello de botella sería la cuota/rate limit de la API de Gemini y los recursos del servidor de LiveKit; ahí se resolvería con balanceo de carga entre varias instancias de LiveKit y rotación de API keys o pasaje a Vertex AI (tier pago con mayor cuota).

---

## 🎯 MVP vs Extras

**MVP (obligatorio para el desafío):**
- [x] Transcripción en tiempo real del idioma original
- [x] Traducción inglés → español
- [x] Subtítulos visibles para la audiencia
- [x] Al menos 2 sesiones simultáneas

**Extras (opcionales, suman puntos — todos diferidos, no prometidos en el MVP):**
- [ ] Traducción español → inglés *(diferido)*
- [ ] Integración con OBS/vMix *(diferida)*
- [x] Glosario de términos técnicos (inyectado como contexto al modelo) — implementado: `glossary.json` + `npm run check:glossary`
- [ ] Exportación de transcripción en SRT/VTT *(diferida)*
- [ ] Panel de monitoreo de todas las sesiones activas *(diferido)*

---

## 📁 Estructura del repo

```
livecast-translate/
├── backend/
│   ├── src/
│   │   ├── sessions/       # manejo de rooms/sesiones
│   │   ├── gemini/         # cliente Live API (ASR + traducción)
│   │   ├── ws/             # distribución por WebSocket
│   │   ├── mic/            # procesamiento de audio de micrófono
│   │   └── scripts/        # utilidades (check-glossary)
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── page.tsx        # selector de sesiones
│   │   ├── [session]/      # vista de audiencia por sala
│   │   ├── mic/            # transcripción desde micrófono
│   │   ├── components/     # componentes reutilizables
│   │   ├── layout.tsx
│   │   └── globals.css
│   └── package.json
├── demo/
│   └── README.md           # instrucciones para archivos de audio
├── glossary.json           # glosario de términos técnicos
└── README.md
```

---

## 📜 Licencia

Este proyecto está licenciado bajo **MIT**, cumpliendo con el requisito de licencia OSI-aprobada del desafío.

---

## 🙌 Créditos

- Desarrollado por **Nico** para la Nerdearla Vibeathon 2026.
- Basado en herramientas abiertas de Google (Gemini Live API examples) y LiveKit.
