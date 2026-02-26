import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown } from "lucide-react";
import { LANGUAGES, getTier1Languages, getTier2Languages, getLanguageByCode } from "../constants/languages";

function flagToTwemojiUrl(flag) {
  const codePoints = Array.from(String(flag || ""))
    .map((ch) => ch.codePointAt(0)?.toString(16))
    .filter(Boolean);
  if (!codePoints.length) return null;
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints.join("-")}.svg`;
}

function FlagIcon({ flag, alt }) {
  const src = flagToTwemojiUrl(flag);
  if (!src) return <span className="text-[18px] leading-none">🌐</span>;
  return <img src={src} alt={alt || "flag"} className="w-[18px] h-[18px] shrink-0" loading="lazy" />;
}

export default function LanguageSelector({ value, onChange, placeholder = "언어 검색..." }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef(null);
  const selected = getLanguageByCode(value) || getLanguageByCode("ko") || LANGUAGES[0];

  const filterLanguages = useMemo(
    () => (langs) => {
      if (!search.trim()) return langs;
      const q = search.toLowerCase();
      return langs.filter((l) => {
        const name = String(l.name || "").toLowerCase();
        const nativeName = String(l.nativeName || "").toLowerCase();
        const code = String(l.code || "").toLowerCase();
        return name.includes(q) || nativeName.includes(q) || code.includes(q);
      });
    },
    [search]
  );

  const tier1Filtered = useMemo(() => filterLanguages(getTier1Languages()), [filterLanguages]);
  const tier2Filtered = useMemo(() => filterLanguages(getTier2Languages()), [filterLanguages]);

  useEffect(() => {
    const onOutside = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const pick = (code) => {
    onChange(code);
    setIsOpen(false);
    setSearch("");
  };

  return (
    <div ref={wrapRef} className="relative w-full max-w-[320px] z-20">
      <button
        type="button"
        onClick={() => setIsOpen((p) => !p)}
        className="w-full px-4 text-left flex items-center justify-between bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[8px] h-[48px]"
      >
        <span className="flex items-center gap-2 min-w-0">
          <FlagIcon flag={selected?.flag} alt={`${selected?.name || ""} flag`} />
          <span className="text-[15px] font-medium text-[var(--color-text)] truncate">
            {selected?.nativeName} ({selected?.name})
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`text-[var(--color-text-secondary)] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen ? (
        <div className="absolute left-0 right-0 mt-1 bg-[var(--color-bg)] rounded-[8px] border border-[var(--color-border)] shadow-[0_4px_20px_rgba(0,0,0,0.1)] z-[100] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]">
            <Search size={16} className="text-[var(--color-text-secondary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              className="w-full text-[14px] outline-none bg-transparent text-[var(--color-text)]"
              autoFocus
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {tier1Filtered.length > 0 ? (
              <>
                {!search.trim() ? (
                  <div className="px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] font-medium bg-[var(--color-bg-secondary)]">
                    자주 사용하는 언어
                  </div>
                ) : null}
                {tier1Filtered.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => pick(lang.code)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#EEF4FF] transition-colors ${
                      value === lang.code ? "bg-[#EEF4FF] text-[var(--color-primary)]" : "text-[var(--color-text)]"
                    }`}
                  >
                    <FlagIcon flag={lang.flag} alt={`${lang.name} flag`} />
                    <span className="text-[14px] truncate">{lang.nativeName}</span>
                    <span className="text-[12px] text-[var(--color-text-secondary)] ml-auto truncate">({lang.name})</span>
                  </button>
                ))}
              </>
            ) : null}

            {tier1Filtered.length > 0 && tier2Filtered.length > 0 && !search.trim() ? (
              <div className="border-t border-[var(--color-border)]" />
            ) : null}

            {tier2Filtered.length > 0 ? (
              <>
                {!search.trim() ? (
                  <div className="px-3 py-1.5 text-[12px] text-[var(--color-text-secondary)] font-medium bg-[var(--color-bg-secondary)]">
                    모든 언어
                  </div>
                ) : null}
                {tier2Filtered.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => pick(lang.code)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#EEF4FF] transition-colors ${
                      value === lang.code ? "bg-[#EEF4FF] text-[var(--color-primary)]" : "text-[var(--color-text)]"
                    }`}
                  >
                    <FlagIcon flag={lang.flag} alt={`${lang.name} flag`} />
                    <span className="text-[14px] truncate">{lang.nativeName}</span>
                    <span className="text-[12px] text-[var(--color-text-secondary)] ml-auto truncate">({lang.name})</span>
                  </button>
                ))}
              </>
            ) : null}

            {tier1Filtered.length === 0 && tier2Filtered.length === 0 ? (
              <div className="px-3 py-4 text-[14px] text-[var(--color-text-secondary)] text-center">검색 결과가 없습니다</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

