import { microphoneProcessor } from './processor.js';
import { LiveTranslateSession } from '../gemini/live-translate.js';

export async function registerMicrophoneRoutes(fastify) {
  // Ruta WebSocket para streaming de audio del micrófono
  fastify.register(async function (fastify) {
    fastify.get('/mic-stream', { websocket: true }, (connection, req) => {
      console.log('🎤 Cliente conectado al stream de micrófono');

      // Inicializar procesador una sola vez y compartir la promesa entre
      // clientes para no procesar texto antes de que termine el init.
      if (!microphoneProcessor.isConnected && !microphoneProcessor.initPromise) {
        microphoneProcessor.initPromise = microphoneProcessor.initialize().catch(error => {
          console.error('Error inicializando procesador:', error);
          microphoneProcessor.initPromise = null;
          if (connection.readyState === 1) {
            connection.send(JSON.stringify({
              type: 'error',
              error: 'Error inicializando procesador de audio'
            }));
          }
        });
      }

      // Enviar mensaje de bienvenida
      connection.send(JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString()
      }));

      // Sesión Live por cliente (audio continuo → traducción sub-segundo).
      // Se crea de forma perezosa con el primer chunk de audio.
      let liveSession = null;
      let liveReady = false;
      const pendingAudio = [];
      // Diagnóstico Live: primer audio recibido + sesión lista.
      let audioCount = 0;
      let audioLogged = false;
      let textCount = 0;
      // Si el Live se cae a mitad de charla se avisa con error duro
      // (nada de fallback silencioso a texto).
      let hadLiveConnect = false;

      const sendToClient = (payload) => {
        if (connection.readyState === 1) {
          connection.send(JSON.stringify(payload));
        }
      };

      const ensureLiveSession = async (targetLang) => {
        if (liveSession) {
          liveSession.setTargetLang(targetLang);
          return liveSession;
        }
        liveSession = new LiveTranslateSession(targetLang || 'es');
        liveSession.on('transcript', sendToClient);
        liveSession.on('connected', () => {
          liveReady = true;
          hadLiveConnect = true;
          console.log('🎤 Live listo, drenando cola:', pendingAudio.length);
          // Drenar el audio que llegó mientras se abría la sesión
          while (pendingAudio.length > 0 && liveReady) {
            liveSession.sendAudio(pendingAudio.shift());
          }
        });
        liveSession.on('error', (err) => {
          console.error('Error Live Translate:', err?.message || err);
          sendToClient({ type: 'error', error: 'live-error' });
        });
        liveSession.on('live-unavailable', () => {
          liveSession = null;
          liveReady = false;
          sendToClient({ type: 'error', error: 'live-unavailable' });
        });
        liveSession.on('closed', () => {
          liveReady = false;
          // Caída real (no rotación: esa se suprime en la sesión).
          // Se avisa con error duro para que el usuario reintente.
          if (hadLiveConnect) {
            hadLiveConnect = false;
            console.warn('⚠️ Sesión Live cerrada a mitad de charla');
            sendToClient({ type: 'error', error: 'live-disconnected' });
          }
        });
        await liveSession.connect();
        return liveSession;
      };

      // Manejar mensajes del cliente (audio PCM o texto transcribido)
      // El handler se registra sincrónicamente (lo exige @fastify/websocket);
      // adentro se espera al init antes de procesar.
      connection.on('message', async message => {
        try {
          const data = JSON.parse(message.toString());

          if (data.type === 'audio' && data.data) {
            // Sin API key no hay Live: se avisa una vez y se ignora el audio
            // (el frontend usa el modo texto local como fallback).
            if (!process.env.GEMINI_API_KEY) {
              sendToClient({ type: 'error', error: 'live-unavailable' });
              return;
            }
            audioCount++;
            if (!audioLogged) {
              audioLogged = true;
              console.log('🎤 Primer audio recibido del cliente, len:', String(data.data).length);
            }
            try {
              const session = await ensureLiveSession(data.targetLang);
              if (liveReady) {
                session.sendAudio(data.data);
              } else if (pendingAudio.length < 50) {
                pendingAudio.push(data.data);
              } else if (!pendingAudio.warned) {
                pendingAudio.warned = true;
                console.warn('⚠️ Cola Live llena (50) y sesión no lista: dropeando audio');
              }
            } catch (err) {
              console.error('Error iniciando Live Translate:', err?.message || err);
              // Falló el arranque: error duro, sin fallback silencioso.
              sendToClient({ type: 'error', error: 'live-error' });
              try {
                await liveSession?.close();
              } catch {
                // ignorar
              }
              liveSession = null;
            }
          } else if (data.type === 'text') {
            textCount++;
            if (textCount === 1) console.log('📝 Primer texto recibido del cliente, interim:', data.interim);
            if (microphoneProcessor.initPromise) {
              await microphoneProcessor.initPromise;
            }
            // Procesar texto con Gemini para traducción.
            // interim=true: parcial en vivo (no va al historial).
            // targetLang: idioma destino ('es' o 'en').
            microphoneProcessor.processText(data.text, (result) => {
              if (connection.readyState === 1) {
                connection.send(JSON.stringify(result));
              }
            }, { targetLang: data.targetLang, interim: data.interim });
          } else if (data.type === 'ping') {
            connection.send(JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString()
            }));
          }
        } catch (error) {
          console.error('Error procesando mensaje del cliente:', error);
        }
      });
      
      // Manejar desconexión
      connection.on('close', async () => {
        console.log('🎤 Cliente desconectado del stream de micrófono');
        try {
          await liveSession?.close();
        } catch {
          // ignorar errores al cerrar
        }
        liveSession = null;
      });
    });
  });
}
