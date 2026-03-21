import React from "react";
import { getFlagUrlByLang, getLabelFromCode } from "../constants/languageProfiles";
import { LANGUAGES, getLanguageByCode } from "../constants/languages";

function flagToTwemojiUrl(flag) {
  const codePoints = Array.from(String(flag || ""))
    .map((ch) => ch.codePointAt(0)?.toString(16))
    .filter(Boolean);
  if (!codePoints.length) return "";
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints.join("-")}.svg`;
}

function getFlagImageUrl(code) {
  const lang = getLanguageByCode(code);
  const emojiFlagUrl = lang?.flag ? flagToTwemojiUrl(lang.flag) : "";
  return emojiFlagUrl || getFlagUrlByLang(code);
}

/** layout="gridOnly" — flag grid only for compact dropdowns (parent controls open state). */
export default function LanguageFlagPicker({ selectedLang, showGrid, onToggleGrid, onSelect, layout = "default" }) {
  const selected = getLanguageByCode(selectedLang) || LANGUAGES[0];

  const renderGrid = (gridClassName) => (
    <div className={gridClassName}>
      {LANGUAGES.map((p) => {
        const isSelected = selected?.code === p.code;
        return (
          <button
            key={p.code}
            type="button"
            onClick={() => onSelect?.(p.code)}
            className={`rounded-[12px] border-2 px-2 py-3 text-center transition-colors ${
              isSelected
                ? "border-[#3B82F6] bg-[#EFF6FF]"
                : "border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[#F8FAFC]"
            }`}
          >
            <img
              src={getFlagImageUrl(p.code)}
              alt={`${p.name} flag`}
              width={48}
              height={48}
              className="w-12 h-12 mx-auto rounded-[8px] object-cover"
              loading="lazy"
            />
            <div className="mt-2 text-[12px] font-semibold tracking-wide text-[var(--color-text)]">
              {getLabelFromCode(p.code) || String(p.code || "").toUpperCase()}
            </div>
          </button>
        );
      })}
    </div>
  );

  if (layout === "gridOnly") {
    return <div className="w-full">{renderGrid("grid grid-cols-4 gap-2 max-h-[min(50vh,320px)] overflow-y-auto p-1")}</div>;
  }

  return (
    <div className="w-full">
      <p className="mb-3 text-[14px] text-center text-[var(--color-text-secondary)]">Select Your Language</p>

      <button
        type="button"
        onClick={onToggleGrid}
        className="w-full rounded-[12px] border-2 border-[#3B82F6] bg-[var(--color-bg)] px-4 py-3 flex items-center justify-center gap-3"
      >
        <img
          src={getFlagImageUrl(selected?.code)}
          alt={`${selected?.name || "Language"} flag`}
          width={48}
          height={48}
          className="w-12 h-12 rounded-[8px] object-cover"
          loading="lazy"
        />
        <div className="text-left">
          <div className="text-[14px] font-semibold text-[var(--color-text)]">
            {getLabelFromCode(selected?.code) || "UNK"}
          </div>
          <div className="text-[12px] text-[var(--color-text-secondary)]">{selected?.name || "Unknown"}</div>
        </div>
      </button>

      {showGrid ? renderGrid("mt-4 grid grid-cols-4 gap-3 max-h-[60vh] overflow-y-auto") : null}
    </div>
  );
}

