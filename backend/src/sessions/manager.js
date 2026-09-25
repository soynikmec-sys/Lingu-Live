import { GeminiLiveClient } from '../gemini/client.js';
import { LiveKitClient } from '../gemini/livekit.js';

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.glossary = null;
  }

  async loadGlossary() {
    const glossaryPath = process.env.GLOSSARY_PATH;
    if (!glossaryPath) return;

    try {
      const fs = await import('fs');
      const path = await import('path');
      const fullPath = path.resolve(process.cwd(), glossaryPath);
      const data = fs.readFileSync(fullPath, 'utf-8');
      this.glossary = JSON.parse(data);
      console.log('📚 Glosario cargado:', Object.keys(this.glossary).length, 'términos');
    } catch (error) {
      console.warn('⚠️  No se pudo cargar el glosario:', error.message);
    }
  }

  getSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      room: session.room,
      status: session.status,
      viewers: session.viewers,
      targetLanguage: session.targetLanguage,
      hasBroadcaster: session.hasBroadcaster === true,
      live: session.status === 'active' && session.hasBroadcaster === true
    }));
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getSessionByRoom(room) {
    for (const session of this.sessions.values()) {
      if (session.room === room && session.status === 'active') return session;
    }
    return null;
  }

  async createSession(room, targetLanguage = 'es') {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const session = {
      id: sessionId,
      room,
      targetLanguage,
      status: 'initializing',
      viewers: 0,
      clients: new Set(),
      hasBroadcaster: false,
      createdAt: new Date()
    };

    this.sessions.set(sessionId, session);

    try {
      const mode = process.env.SESSION_MODE || 'demo';
      
      if (mode === 'live') {
        // Modo live: Gemini + LiveKit reales
        const geminiClient = new GeminiLiveClient(targetLanguage, this.glossary);
        const liveKitClient = new LiveKitClient(room);
        
        session.geminiClient = geminiClient;
        session.liveKitClient = liveKitClient;
        
        await this.setupLiveSession(session);
      } else {
        // Modo demo: stub sin conexiones reales
        await this.setupDemoSession(session);
      }
      
      session.status = 'active';
      console.log(`✅ Sesión creada: ${sessionId} (room: ${room})`);
    } catch (error) {
      console.error(`❌ Error creando sesión ${sessionId}:`, error);
      session.status = 'error';
      session.error = error.message;
    }

    return session;
  }

  async setupLiveSession(session) {
    // Conectar a LiveKit
    await session.liveKitClient.connect();
    
    // Conectar a Gemini Live API
    await session.geminiClient.connect();
    
    // Manejar audio de LiveKit → Gemini
    session.liveKitClient.on('audio', (audioData) => {
      session.geminiClient.sendAudio(audioData);
    });
    
    // Manejar transcripción de Gemini → distribución
    session.geminiClient.on('transcript', (data) => {
      this.broadcastToSession(session.id, {
        type: 'transcript',
        sessionId: session.id,
        ...data
      });
    });
    
    // Manejar errores
    session.geminiClient.on('error', (error) => {
      console.error(`Error Gemini en sesión ${session.id}:`, error);
      this.broadcastToSession(session.id, {
        type: 'error',
        sessionId: session.id,
        error: error.message
      });
    });
  }

  async setupDemoSession(session) {
    // Modo demo: simular transcripción sin conexiones reales
    console.log(`🎭 Modo demo activado para sesión ${session.id}`);
    
    // Simular transcripción periódica (pausada mientras haya un
    // broadcaster real transmitiendo en la sala)
    const demoInterval = setInterval(() => {
      if (session.status !== 'active') {
        clearInterval(demoInterval);
        return;
      }

      if (session.hasBroadcaster) return;

      const demoTexts = [
        'Bienvenidos a esta conferencia sobre tecnología.',
        'Hoy vamos a hablar sobre inteligencia artificial.',
        'Los avances en machine learning son increíbles.',
        'La transcripción en tiempo real es muy útil.',
        'Gracias por asistir a esta sesión.'
      ];
      
      const randomText = demoTexts[Math.floor(Math.random() * demoTexts.length)];
      
      this.broadcastToSession(session.id, {
        type: 'transcript',
        sessionId: session.id,
        originalText: randomText,
        translatedText: randomText, // En demo no hay traducción real
        language: 'es',
        timestamp: new Date().toISOString()
      });
    }, 3000);
    
    session.demoInterval = demoInterval;
  }

  addClient(sessionId, ws) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    
    session.clients.add(ws);
    session.viewers = session.clients.size;
    
    ws.on('close', () => {
      session.clients.delete(ws);
      session.viewers = session.clients.size;
    });
    
    return true;
  }

  broadcastToSession(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const messageStr = JSON.stringify(message);
    
    session.clients.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(messageStr);
      }
    });
  }

  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    session.status = 'closing';
    
    // Cerrar conexiones
    if (session.geminiClient) {
      await session.geminiClient.disconnect();
    }
    
    if (session.liveKitClient) {
      await session.liveKitClient.disconnect();
    }
    
    if (session.demoInterval) {
      clearInterval(session.demoInterval);
    }
    
    // Cerrar conexiones WebSocket de clientes
    session.clients.forEach(client => {
      if (client.readyState === 1) {
        client.close();
      }
    });
    
    this.sessions.delete(sessionId);
    console.log(`🔒 Sesión cerrada: ${sessionId}`);
  }

  async initializeFromConfig() {
    await this.loadGlossary();
    
    const rooms = (process.env.SESSION_ROOMS || 'room-a,room-b').split(',');
    const targetLanguage = process.env.TARGET_LANGUAGES || 'es';
    
    console.log(`🎯 Inicializando ${rooms.length} sesiones desde configuración...`);
    
    for (const room of rooms) {
      const trimmedRoom = room.trim();
      if (trimmedRoom) {
        try {
          await this.createSession(trimmedRoom, targetLanguage);
        } catch (error) {
          console.error(`❌ Error inicializando sesión para room ${trimmedRoom}:`, error.message);
        }
      }
    }
    
    console.log(`✅ ${this.sessions.size} sesiones activas`);
  }
}

export const sessionManager = new SessionManager();
