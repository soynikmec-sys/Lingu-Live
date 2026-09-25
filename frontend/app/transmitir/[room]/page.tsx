'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import MicStudio from '../../components/MicStudio';

// Transmisión en vivo a una sala: la misma experiencia de /mic,
// pero lo transcripto se publica a la audiencia de la sala.
export default function TransmitirPage() {
  const params = useParams();
  const room = params.room as string;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const resolve = async () => {
      try {
        const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
        const response = await fetch(`${backendHttp}/sessions/room/${encodeURIComponent(room)}`);
        if (!response.ok) throw new Error('Sala no encontrada');
        const data = await response.json();
        setSessionId(data.id);
      } catch (err) {
        setError('No se pudo abrir la sala. Revisá que el backend esté corriendo.');
        console.error(err);
      }
    };
    resolve();
  }, [room]);

  if (error) {
    return (
      <div className="container">
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div className="container">
        <div className="loading">Abriendo sala {room}...</div>
      </div>
    );
  }

  return (
    <MicStudio
      sessionId={sessionId}
      title={`Transmitiendo en ${room}`}
    />
  );
}
