'use client';

import { useEffect, useState } from 'react';
import LanguagePicker from './components/LanguagePicker';

interface Session {
  id: string;
  room: string;
  status: string;
  viewers: number;
  targetLanguage: string;
  hasBroadcaster?: boolean;
  live?: boolean;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '').slice(0, 40);

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Crear sala
  const [showCreate, setShowCreate] = useState(false);
  const [newRoom, setNewRoom] = useState('');
  const [newLang, setNewLang] = useState('es');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  const createRoom = async () => {
    const room = slugify(newRoom);
    if (!room) {
      setCreateError('Poné un nombre para la sala.');
      return;
    }
    if (sessions.some((s) => s.room === room)) {
      setCreateError('Ya existe una sala con ese nombre.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const backendHttp = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3003';
      const response = await fetch(`${backendHttp}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, targetLanguage: newLang }),
      });
      if (!response.ok) throw new Error('No se pudo crear la sala');
      setNewRoom('');
      setNewLang('es');
      setShowCreate(false);
      await fetchSessions();
    } catch (err) {
      setCreateError('No se pudo crear la sala. Revisá la conexión.');
      console.error(err);
    } finally {
      setCreating(false);
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
        <img
          src="/logo.jpeg"
          alt="Lingo Live"
          width={150}
          height={150}
          style={{ borderRadius: '28px', marginBottom: '1rem' }}
        />
        <p>Cargando sesiones disponibles...</p>
        </div>
        <div className="loading">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <img
          src="/logo.jpeg"
          alt="Lingo Live"
          width={150}
          height={150}
          style={{ borderRadius: '28px', marginBottom: '1rem' }}
        />
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
          🎤 Probar micrófono
        </button>
        <button
          className="mic-button"
          onClick={() => setShowCreate(!showCreate)}
          style={{
            background: 'white',
            color: '#667eea',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '8px',
            fontSize: '1rem',
            cursor: 'pointer' as const,
            marginTop: '1rem',
            marginLeft: '0.5rem',
            fontWeight: '600'
          }}
        >
          ➕ Crear sala
        </button>
      </div>

      {showCreate && (
        <div className="session-card" style={{ cursor: 'default', marginBottom: '1.5rem' }}>
          <h3>Nueva sala</h3>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '0.75rem' }}>
            <input
              value={newRoom}
              onChange={(e) => setNewRoom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createRoom(); }}
              placeholder="Nombre (ej. escenario-c)"
              aria-label="Nombre de la sala"
              style={{
                flex: 1,
                minWidth: '180px',
                padding: '0.6rem 0.9rem',
                borderRadius: '8px',
                border: '1px solid #ddd',
                fontSize: '1rem'
              }}
            />
            <LanguagePicker kind="target" value={newLang} onChange={setNewLang} />
            <button
              className="back-button"
              style={{ marginBottom: 0 }}
              onClick={createRoom}
              disabled={creating}
            >
              {creating ? 'Creando…' : 'Crear'}
            </button>
          </div>
          {createError && (
            <div className="error" style={{ marginTop: '0.75rem' }}>
              {createError}
            </div>
          )}
          <div className="info" style={{ marginTop: '0.5rem' }}>
            <div className="info-item">Las salas creadas viven en memoria: se pierden si el servidor reinicia.</div>
          </div>
        </div>
      )}

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
                onClick={() => window.location.href = `/ver/${encodeURIComponent(session.room)}`}
              >
                Ver
              </button>
              <button
                className="back-button"
                style={{ marginBottom: 0, flex: 1, opacity: session.live ? 0.5 : 1 }}
                onClick={() => window.location.href = `/transmitir/${encodeURIComponent(session.room)}`}
                disabled={session.live === true}
                title={session.live ? 'Ya hay alguien transmitiendo en esta sala' : 'Transmitir en esta sala'}
              >
                {session.live ? '🔴 En vivo' : '🎙️ Transmitir'}
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
