# Demo Audio Files

Esta carpeta contiene archivos de audio para pruebas en modo demo.

## Archivo de ejemplo

Para testing, puedes usar cualquier archivo de audio en formato WAV:

1. Descarga un archivo de audio de prueba (puedes usar charlas públicas de conferencias)
2. Colócalo en esta carpeta como `audio-sample.wav`
3. El backend en modo demo simulará transcripción sin procesar audio real

## Para modo LIVE

Para usar el modo live con procesamiento real:
1. Configura `GEMINI_API_KEY` en `backend/.env`
2. Configura `SESSION_MODE=live` en `backend/.env`
3. Asegúrate de tener LiveKit corriendo (ver README principal)
4. El sistema procesará audio real de LiveKit a través de Gemini Live API

## Nota

El modo demo (configuración por defecto) no requiere archivos de audio reales, ya que simula la transcripción para demostrar la interfaz.
