import { sessionManager } from '../sessions/manager.js';
import { microphoneProcessor } from '../mic/processor.js';
import { LiveTranslateSession } from '../gemini/live-translate.js';

// WS de broadcaster por sala: el transmisor habla y lo que transcribe
// se publica en vivo a todos los viewers de ESA sesión (independiente
// del resto). Mismo contrato de mensajes que /mic-stream, más audio:
// - texto → REST (eco + publicación)
// - audio → Live (transcripts) + reenvío del audio ORIGINAL a viewers
export async function registerBroadcastRoutes(fastify) {
  fastify.register(async function (fastify) {
    fastify.get('/broadcast/:sessionId', { websocket: true }, (connection, req) => {
      const { sessionId } = req.params;

      const session = sessionManager.getSession(sessionId);
      if (!session || session.status !== 'active') {
        connection.send(JSON.stringify({
          type: 'error',
          error: 'Sesión no encontrada o inactiva'
        }));
        connection.close();
        return;
      }

      // Una sala = un transmisor a la vez (como un directo real)
      if (session.hasBroadcaster) {
        connection.send(JSON.stringify({
          type: 'error',
          error: 'Sala ocupada: ya hay un transmisor en vivo'
        }));
        connection.close();
        return;
      }

      console.log(`🎙️ Broadcaster conectado a sesión ${sessionId} (room: ${session.room})`);

      // Inicializar procesador una sola vez (promesa compartida)
      if (!microphoneProcessor.isConnected && !microphoneProcessor.initPromise) {
        microphoneProcessor.initPromise = microphoneProcessor.initialize().catch(error => {
          console.error('Error inicializando procesador:', error);
          microphoneProcessor.initPromise = null;
        });
      }

      session.hasBroadcaster = true;

      connection.send(JSON.stringify({
        type: 'connected',
        role: 'broadcaster',
        sessionId,
        room: session.room,
        timestamp: new Date().toISOString()
      }));

      // Sesión Live propia del broadcaster (transcripts con eco + publish).
      // El audio ORIGINAL además se reenvía crudo a los viewers.
      let liveSession = null;
      let liveReady = false;
      let hadLiveConnect = false;
      const pendingAudio = [];

      const sendToClient = (payload) => {
        if (connection.readyState === 1) {
          connection.send(JSON.stringify(payload));
        }
      };

      const publishTranscript = (result) => {
        // 1) Eco al broadcaster (ve lo mismo que en /mic)
        sendToClient(result);
        // 2) Publicación a los viewers de ESTA sala
        if (result.type === 'transcript') {
          sessionManager.broadcastToSession(sessionId, {
            ...result,
            sessionId
          });
        }
      };

      const ensureLiveSession = async (targetLang) => {
        if (liveSession) {
          liveSession.setTargetLang(targetLang);
          return liveSession;
        }
        liveSession = new LiveTranslateSession(targetLang || session.targetLanguage || 'es');
        liveSession.on('transcript', publishTranscript);
        liveSession.on('connected', () => {
          liveReady = true;
          hadLiveConnect = true;
          console.log(`🎤 Live de sala listo (${session.room}), drenando cola:`, pendingAudio.length);
          while (pendingAudio.length > 0 && liveReady) {
            liveSession.sendAudio(pendingAudio.shift());
          }
        });
        liveSession.on('error', () => {
          sendToClient({ type: 'error', error: 'live-error' });
        });
        liveSession.on('live-unavailable', () => {
          liveSession = null;
          liveReady = false;
          sendToClient({ type: 'error', error: 'live-unavailable' });
        });
        liveSession.on('closed', () => {
          liveReady = false;
          if (hadLiveConnect) {
            hadLiveConnect = false;
            sendToClient({ type: 'error', error: 'live-disconnected' });
          }
        });
        await liveSession.connect();
        return liveSession;
      };

      connection.on('message', async message => {
        try {
          const data = JSON.parse(message.toString());

          if (data.type === 'audio' && data.data) {
            // 1) Audio ORIGINAL directo a los viewers (sin esperar al Live)
            sessionManager.broadcastToSession(sessionId, {
              type: 'audio',
              data: data.data,
              sessionId
            });
            // 2) Live para traducir (eco + publicación de transcripts)
            if (!process.env.GEMINI_API_KEY) return;
            try {
              const live = await ensureLiveSession(data.targetLang);
              if (liveReady) {
                live.sendAudio(data.data);
              } else if (pendingAudio.length < 50) {
                pendingAudio.push(data.data);
              }
            } catch (err) {
              console.error('Error iniciando Live de sala:', err?.message || err);
              sendToClient({ type: 'error', error: 'live-error' });
              try { await liveSession?.close(); } catch { /* ignorar */ }
              liveSession = null;
            }
          } else if (data.type === 'text') {
            if (microphoneProcessor.initPromise) {
              await microphoneProcessor.initPromise;
            }
            microphoneProcessor.processText(data.text, (result) => {
              if (connection.readyState !== 1) return;
              // 1) Eco al broadcaster (ve lo mismo que en /mic)
              connection.send(JSON.stringify(result));
              // 2) Publicación a los viewers de ESTA sala
              if (result.type === 'transcript') {
                sessionManager.broadcastToSession(sessionId, {
                  ...result,
                  sessionId
                });
              }
            }, { targetLang: data.targetLang, interim: data.interim });
          } else if (data.type === 'ping') {
            connection.send(JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString()
            }));
          }
        } catch (error) {
          console.error('Error procesando mensaje del broadcaster:', error);
        }
      });

      connection.on('close', () => {
        console.log(`🎙️ Broadcaster desconectado de sesión ${sessionId}`);
        try { liveSession?.close(); } catch { /* ignorar */ }
        liveSession = null;
        const s = sessionManager.getSession(sessionId);
        if (s) s.hasBroadcaster = false;
      });
    });
  });
}
