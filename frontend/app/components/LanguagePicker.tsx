'use client';

import { useState, useRef, useEffect } from 'react';
import { Languages, ArrowRightLeft, Check } from 'lucide-react';
import { ALL_LANGS, PINNED_LANGS, shortLabel, type LangOption } from './languages';

interface LanguagePickerProps {
  // 'speak' = idioma que hablás (usa speechTag), 'target' = idioma que ves (usa code)
  kind: 'speak' | 'target';
  value: string;
  onChange: (value: string) => void;
}

// Normaliza para búsqueda sin tildes (ej. "japones" encuentra "Japonés")
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function LanguagePicker({ kind, value, onChange }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const current: LangOption =
    kind === 'speak'
      ? ALL_LANGS.find((l) => l.speechTag === value) ?? PINNED_LANGS[0]
      : ALL_LANGS.find((l) => l.code === value) ?? PINNED_LANGS[1] ?? PINNED_LANGS[0];

  const q = norm(query.trim());
  const filtered = q
    ? ALL_LANGS.filter((l) => norm(l.label).includes(q) || norm(l.code).startsWith(q))
    : ALL_LANGS;
  // Los fijos no se repiten en "Todos" cuando no hay búsqueda
  const rest = q ? [] : ALL_LANGS.filter((l) => !PINNED_LANGS.includes(l));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Foco al buscador al abrir
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open ]);

  const pick = (opt: LangOption) => {
    onChange(kind === 'speak' ? opt.speechTag : opt.code);
    setOpen(false);
    setQuery('');
  };

  const isActive = (opt: LangOption) =>
    kind === 'speak' ? opt.speechTag === value : opt.code === value;

  const renderRow = (opt: LangOption) => (
    <button
      key={opt.code}
      className={`lang-opt ${isActive(opt) ? 'selected' : ''}`}
      onClick={() => pick(opt)}
      role="option"
      aria-selected={isActive(opt)}
    >
      <span>{opt.label}</span>
      {isActive(opt) && <Check size={16} />}
    </button>
  );

  return (
    <div className="lang-picker" ref={rootRef}>
      <button
        className="lang-pill"
        onClick={() => {
          setQuery('');
          setOpen(!open);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={kind === 'speak' ? 'Idioma que hablás' : 'Idioma de traducción'}
        aria-label={kind === 'speak' ? 'Idioma que hablás' : 'Idioma de traducción'}
        type="button"
      >
        {kind === 'speak' ? <Languages size={15} /> : <ArrowRightLeft size={15} />}
        <span>{shortLabel(current)}</span>
      </button>
      {open && (
        <div className="lang-menu" role="listbox">
          <input
            ref={searchRef}
            className="lang-search"
            placeholder="Buscar idioma…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar idioma"
          />
          <div className="lang-list">
            {!q && (
              <>
                <div className="lang-group">Fijos</div>
                {PINNED_LANGS.map(renderRow)}
                <div className="lang-group">Todos</div>
                {rest.map(renderRow)}
              </>
            )}
            {q && filtered.length > 0 && filtered.map(renderRow)}
            {q && filtered.length === 0 && (
              <div className="lang-empty">Sin resultados para “{query}”</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
