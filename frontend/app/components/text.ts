// Helpers de texto compartidos (MicStudio + SessionViewer).

export interface TranscriptLike {
  originalText?: string;
  translatedText?: string;
}

// En modo demo (o mismo idioma) original y traducido son el mismo texto:
// mostrarlo una sola vez para que no parezca duplicado.
export const sameText = (t: TranscriptLike) =>
  (t.originalText ?? '').trim() !== '' &&
  t.originalText!.trim() === (t.translatedText ?? '').trim();

// El Live acumula párrafos largos sin partir: en pantalla se muestran
// solo las últimas N oraciones (el historial guarda el texto completo).
export const tailSentences = (text: string | undefined, n = 2) => {
  const t = (text ?? '').trim();
  if (!t) return '';
  const parts = t.match(/[^.!?…]+[.!?…]+["”)]?|\S[^.!?…]*$/g);
  if (!parts || parts.length <= n) return t;
  return parts.slice(-n).join(' ').trim();
};
