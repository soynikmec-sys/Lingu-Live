'use client';

import { useEffect, useState } from 'react';

interface Session {
  id: string;
  room: string;
  status: string;
  viewers: number;
  targetLanguage: string;
  hasBroadcaster?: boolean;
  live?: boolean;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
    
    // Refrescar sesiones cada 5 segundos
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchSessions = async () => {
    try {
      const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
      const response = await fetch(`${backendHttp}/sessions`);
      if (!response.ok) throw new Error('Error fetching sessions');
      
      const data = await response.json();
      setSessions(data.sessions || []);
      setError(null);
    } catch (err) {
      setError('Error conectando con el backend');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'active': return 'active';
      case 'initializing': return 'initializing';
      case 'error': return 'error';
      default: return '';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return 'Activa';
      case 'initializing': return 'Iniciando';
      case 'error': return 'Error';
      default: return status;
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="header">
          <h1>🎙️ LiveCast Translate</h1>
          <p>Cargando sesiones disponibles...</p>
        </div>
        <div className="loading">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🎙️ LiveCast Translate</h1>
        <p>Selecciona una sesión para ver los subtítulos en tiempo real</p>
        <button 
          className="mic-button"
          onClick={() => window.location.href = '/mic'}
          style={{
            background: 'white',
            color: '#667eea',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontSize: '1rem',
            cursor: 'pointer' as const,
            marginTop: '1rem',
            fontWeight: '600'
          }}
        >
          🎤 Transcribir desde Micrófono
        </button>
      </div>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <div className="session-grid">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="session-card"
          >
            <h3>
              {session.room}{' '}
              {session.live && (
                <span className="status active" style={{ marginLeft: '0.5rem' }}>
                  ● EN VIVO
                </span>
              )}
            </h3>
            <span className={`status ${getStatusClass(session.status)}`}>
              {getStatusText(session.status)}
            </span>
            <div className="info">
              <div className="info-item">👥 Espectadores: {session.viewers}</div>
              <div className="info-item">🌐 Idioma: {session.targetLanguage}</div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button
                className="back-button"
                style={{ marginBottom: 0, flex: 1 }}
                onClick={() => window.location.href = `/${session.id}`}
              >
                Ver
              </button>
              <button
                className="back-button"
                style={{ marginBottom: 0, flex: 1 }}
                onClick={() => window.location.href = `/transmitir/${encodeURIComponent(session.room)}`}
              >
                🎙️ Transmitir
              </button>
            </div>
          </div>
        ))}
      </div>

      {sessions.length === 0 && !error && (
        <div className="loading">
          No hay sesiones activas. El backend podría estar en modo demo.
        </div>
      )}
    </div>
  );
}
