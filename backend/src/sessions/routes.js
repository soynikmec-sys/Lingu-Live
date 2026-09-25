import { sessionManager } from './manager.js';

export async function registerSessionRoutes(fastify) {
  // Obtener todas las sesiones activas
  fastify.get('/sessions', async (request, reply) => {
    const sessions = sessionManager.getSessions();
    return { sessions };
  });

  // Obtener detalles de una sesión específica
  fastify.get('/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    const session = sessionManager.getSession(sessionId);
    
    if (!session) {
      reply.code(404);
      return { error: 'Sesión no encontrada' };
    }
    
    return session;
  });

  // Obtener (o crear) la sesión activa de una room por nombre.
  // Las rooms son estables (room-a, room-b); los ids rotan por boot.
  fastify.get('/sessions/room/:room', async (request, reply) => {
    const { room } = request.params;
    let session = sessionManager.getSessionByRoom(room);

    if (!session) {
      session = await sessionManager.createSession(room, process.env.TARGET_LANGUAGES || 'es');
    }

    return {
      id: session.id,
      room: session.room,
      status: session.status,
      viewers: session.viewers,
      targetLanguage: session.targetLanguage,
      hasBroadcaster: session.hasBroadcaster === true,
      live: session.status === 'active' && session.hasBroadcaster === true
    };
  });

  // Crear una nueva sesión
  fastify.post('/sessions', async (request, reply) => {
    const { room, targetLanguage } = request.body;
    
    if (!room) {
      reply.code(400);
      return { error: 'Se requiere el parámetro "room"' };
    }
    
    const session = await sessionManager.createSession(room, targetLanguage || 'es');
    return session;
  });

  // Cerrar una sesión
  fastify.delete('/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;
    await sessionManager.closeSession(sessionId);
    return { message: 'Sesión cerrada' };
  });
}
