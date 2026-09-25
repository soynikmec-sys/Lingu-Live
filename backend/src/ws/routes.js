import { sessionManager } from '../sessions/manager.js';

export async function registerWebSocketRoutes(fastify) {
  // Ruta WebSocket para streaming de subtítulos
  fastify.register(async function (fastify) {
    fastify.get('/stream/:sessionId', { websocket: true }, (connection, req) => {
      const { sessionId } = req.params;
      
      console.log(`🔌 Cliente conectado al stream de sesión: ${sessionId}`);
      
      // NOTA: con @fastify/websocket el primer argumento del handler YA es
      // el socket WebSocket (ws), no un wrapper. No usar `connection.socket`.
      // Verificar que la sesión existe
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        connection.send(JSON.stringify({
          type: 'error',
          error: 'Sesión no encontrada'
        }));
        connection.close();
        return;
      }

      // Agregar cliente a la sesión
      const added = sessionManager.addClient(sessionId, connection);
      if (!added) {
        connection.send(JSON.stringify({
          type: 'error',
          error: 'No se pudo agregar a la sesión'
        }));
        connection.close();
        return;
      }

      // Enviar mensaje de bienvenida
      connection.send(JSON.stringify({
        type: 'connected',
        sessionId,
        room: session.room,
        targetLanguage: session.targetLanguage,
        timestamp: new Date().toISOString()
      }));

      // Manejar mensajes del cliente
      connection.on('message', message => {
        try {
          const data = JSON.parse(message);

          if (data.type === 'ping') {
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
      connection.on('close', () => {
        console.log(`🔌 Cliente desconectado del stream: ${sessionId}`);
      });
    });
  });
}
