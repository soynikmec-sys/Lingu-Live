import { RoomServiceClient, AccessToken } from 'livekit-server-sdk';
import EventEmitter from 'events';

export class LiveKitClient extends EventEmitter {
  constructor(roomName) {
    super();
    this.roomName = roomName;
    this.isConnected = false;
    this.roomServiceClient = null;
    this.room = null;
  }

  async connect() {
    try {
      const livekitUrl = process.env.LIVEKIT_URL || 'ws://localhost:7880';
      const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
      const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';

      this.roomServiceClient = new RoomServiceClient(
        livekitUrl,
        apiKey,
        apiSecret
      );

      // Crear o obtener la room
      try {
        await this.roomServiceClient.createRoom({
          name: this.roomName,
          emptyTimeout: 300 // 5 minutos
        });
        console.log(`🏠 Room creada: ${this.roomName}`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`🏠 Room existente: ${this.roomName}`);
        } else {
          throw error;
        }
      }

      this.isConnected = true;
      this.emit('connected');
    } catch (error) {
      console.error('Error conectando a LiveKit:', error);
      throw error;
    }
  }

  async generateToken(participantName) {
    const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
    const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantName,
      name: participantName
    });

    at.addGrant({
      room: this.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true
    });

    return at.toJwt();
  }

  async disconnect() {
    if (this.room) {
      this.room = null;
    }
    
    this.isConnected = false;
    this.emit('disconnected');
    console.log(`🔌 Desconectado de LiveKit room: ${this.roomName}`);
  }

  getRoomInfo() {
    return {
      name: this.roomName,
      connected: this.isConnected
    };
  }
}
