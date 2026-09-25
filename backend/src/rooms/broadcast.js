import { sessionManager } from '../sessions/manager.js';
import { microphoneProcessor } from '../mic/processor.js';

// WS de broadcaster por sala: el transmisor habla y lo que transcribe
// se publica en vivo a todos los viewers de ESA sesión (independiente
// del resto). Mismo contrato de mensajes que /mic-stream.
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

      connection.on('message', async message => {
        try {
          const data = JSON.parse(message.toString());

          if (data.type === 'text') {
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
        const s = sessionManager.getSession(sessionId);
        if (s) s.hasBroadcaster = false;
      });
    });
  });
}
