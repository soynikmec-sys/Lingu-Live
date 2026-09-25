import dotenv from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerSessionRoutes } from './sessions/routes.js';
import { registerWebSocketRoutes } from './ws/routes.js';
import { registerMicrophoneRoutes } from './mic/routes.js';
import { registerTtsRoutes } from './tts/routes.js';
import { registerBroadcastRoutes } from './rooms/broadcast.js';
import { sessionManager } from './sessions/manager.js';

dotenv.config();

const fastify = Fastify({
  logger: true
});

// Registrar plugins
fastify.register(cors, {
  origin: true
});

fastify.register(websocket);

// Registrar rutas
fastify.register(registerSessionRoutes);
fastify.register(registerWebSocketRoutes);
fastify.register(registerMicrophoneRoutes);
fastify.register(registerTtsRoutes);
fastify.register(registerBroadcastRoutes);

// Ruta de health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Iniciar servidor
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Backend corriendo en http://localhost:${port}`);
    
    // Inicializar sesiones desde configuración
    await sessionManager.initializeFromConfig();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
