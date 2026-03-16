# Translation Pipeline Audit: Normal vs Hospital/Org Rooms

**Date:** 2026-03-16  
**Scope:** Read-only; no code changes.

---

## 1. SYSTEM PROMPT DIFFERENCES

### 1.1 buildSystemPrompt — location and signature

**File:** `server.js`  
**Function:** `buildSystemPrompt(from, to, ctx, siteContext, opts = {})`  
**Approx. lines:** 1695–1765

**Parameters:**
- `from` — source language code (e.g. `'ko'`, `'en'`)
- `to` — target language code
- `ctx` — recent conversation context string (from `getRoomContext`)
- `siteContext` — string (e.g. `'general'`, `'hospital_plastic_surgery'`, `'org_...'`)
- `opts` — optional; `opts.contextInject === true` forces medical-style prompt when not hospital

**Logic summary:**
- `siteDomain = SITE_CONTEXT_PROMPTS[siteContext] || SITE_CONTEXT_PROMPTS.general`
- `isHospital = isHospitalContext(siteContext)` → `siteContext.startsWith('hospital_')`
- `contextInject = opts.contextInject === true`
- If `(isHospital || contextInject)`:
  - `dept = String(siteContext || "").replace(/^hospital_|^org_/, "")` (e.g. `hospital_plastic_surgery` → `plastic_surgery`)
  - `medicalTerms = (isHospital || contextInject) ? getMedicalTermContext(dept, to) : ""`
  - If `isMedical = isHospital || (contextInject && medicalTerms)`: return **hospital/medical** prompt (siteDomain + medicalTerms + medical instructions + optional `hospitalRegister`).
- Else: return **general** prompt.

**getMedicalTermContext:**
- **File:** `server/constants/medicalKnowledge.js` (required at server.js ~1074)
- **Called when:** `(isHospital || contextInject)` is true; then `medicalTerms = getMedicalTermContext(dept, to)`.
- **Signature:** `getMedicalTermContext(dept = 'reception', targetLang = 'en')`
- **Behavior:** Uses `DEPT_TERM_MAP[dept]` (e.g. `plastic_surgery` → COMMON_HOSPITAL, PLASTIC_SURGERY, COSMETIC_DERMATOLOGY, MEDICATIONS). Builds a block of lines `- ${term.ko} = ${target}` and wraps them in a fixed header/footer string (전문 의료 통역 지침, 번역 원칙).
- **Conditions:** Always called when `isHospital || contextInject`; result is empty string only if `contextInject` is true but `medicalTerms` was not assigned (in practice both hospital and contextInject get medical terms when isMedical is true).

### 1.2 Full system prompt — (a) Normal room

**Assumption:** `siteContext = 'general'` (or missing), so `isHospital` is false and the function takes the “General mode” branch.

**Full prompt text (concatenated):**

```
You are a professional real-time interpreter for MONO multilingual messenger.
This is a casual chat messenger. Users use slang, abbreviations, and shorthand.
Domain context: Domain: General workplace. Clear, professional, direct language.
Translate from ${label(from)} to ${label(to)} with conversation context awareness.
Always preserve speaker tone and intensity: casual->casual, formal->formal, rude->rude, playful->playful.
Internet slang must be translated to equivalent slang in target language.
Examples: ㅇㅇ->yeah, ㄱㄱ->let's go, ㅋㅋㅋ->lol, lol->ㅋㅋ, nvm->됐어/아니야, idk->몰라, www->ㅋㅋㅋ, 666/yyds->sick/goat, 555->lol.
Do not literal-translate slang if natural equivalent exists in target language.
Honorific/formal Korean must remain formal and polite in English (business-like register).
When prior context clearly points to a specific person, prefer natural person pronouns over generic "them".
For Korean deferential endings like "감사합니다", "부탁드립니다/부탁드리겠습니다", use polite business English (e.g., "I would appreciate...", "could you please...").
For colloquial Korean pronouns like "걔/그 사람", prefer a natural singular pronoun (him/her) when context indicates one person.
Preserve proper nouns, brand names, numbers, units, and safety-critical terms accurately.
Preserve emojis/emoticons (e.g., ㅠㅠ, :) ) as-is unless target has a direct equivalent emoji.
If message is ambiguous, use conversation context to resolve references/pronouns.
If message is not empty, NEVER refuse and NEVER ask for more text. Always output best-effort translation.
[If ctx provided:] Recent speaker hints:\n${ctx}
Output ONLY translated text. No explanation, no notes, no quotation marks, no brackets.
```

### 1.3 Full system prompt — (b) Hospital room (siteContext = 'hospital_plastic_surgery')

**Assumption:** `siteContext = 'hospital_plastic_surgery'`, so `isHospital` is true, `dept = 'plastic_surgery'`, `getMedicalTermContext('plastic_surgery', to)` returns the plastic_surgery + common hospital glossary block.

**Full prompt text (concatenated):**

```
[First: SITE_CONTEXT_PROMPTS.hospital_plastic_surgery]
You are a professional medical interpreter specializing in Plastic and Cosmetic Surgery. Translate accurately in the context of cosmetic and reconstructive surgical consultations, pre/post-operative care, and aesthetic procedures. Prioritize precise translation of terms related to: rhinoplasty, blepharoplasty, facelift, liposuction, breast augmentation, botox, filler, laser treatment, skin rejuvenation, scar revision, jaw surgery, cheekbone reduction, fat grafting, thread lifting, recovery period, swelling, bruising, compression garments, follow-up appointments. Patient safety is the top priority — never omit or alter surgical instructions, medication dosages, or post-operative care guidelines.

[Second: medicalTerms from getMedicalTermContext('plastic_surgery', toLang)]
[전문 의료 통역 지침]
당신은 병원 전문 의료통역사입니다.
...
[PLASTIC_SURGERY 과 전문용어]
- 쌍꺼풀 = ...
- 코성형 = ...
... (etc.)

Translate from ${label(from)} to ${label(to)} with conversation context awareness.
Maintain a professional medical tone. Use standard medical terminology in the target language.
When medical terms from the glossary above appear, you MUST use the provided translations.
Preserve proper nouns, medication names, dosages, numbers, units, and medical terms accurately.

[Third: hospitalRegister — CRITICAL Hospital Mode Language Register block]
CRITICAL — Hospital Mode Language Register:
Always translate using the highest level of formal, respectful language...
(존댓말/formal register instructions)

If message is ambiguous, use conversation context to resolve. Always output best-effort translation.
[If ctx provided:] Recent conversation context:\n${ctx}
Output ONLY translated text. No explanation, no notes, no quotation marks, no brackets.
```

---

## 2. TRANSLATION FUNCTION DIFFERENCES

### 2.1 fastTranslate and hqTranslate — same API, no hospital branching

**fastTranslate** (server.js ~1893–1945):
- **Signature:** `fastTranslate(text, from, to, ctx, siteContext, conversationHistory = [], opts = {})`
- **Model:** `gpt-4o` (both stream and non-stream)
- **Temperature:** `0.3`
- **max_tokens:** `1024`
- **System prompt:** `buildSystemPrompt(from, to, ctx, siteContext || 'general', opts)` — so hospital vs normal is determined only by `siteContext` and `opts.contextInject` inside `buildSystemPrompt`. No separate “hospital” branch in fastTranslate itself.

**hqTranslate** (server.js ~1948–1977):
- **Signature:** `hqTranslate(text, from, to, ctx, siteContext, conversationHistory = [], opts = {})`
- **Model:** `gpt-4o`
- **Temperature:** `0.3`
- **max_tokens:** `1024`
- **System prompt:** Same as fastTranslate **plus** suffix: `"\nRefine to fluent native chat style without changing meaning or emotional tone."`

**Conclusion:** Hospital vs normal is **not** handled by different models or temperatures. Both room types use the same model (gpt-4o) and temperature (0.3). The only difference is the **system prompt** (buildSystemPrompt), which is determined by the `siteContext` (and optionally `opts.contextInject`) passed into fastTranslate/hqTranslate.

### 2.2 Are they called differently for hospital vs normal?

- **Call sites** pass `siteCtx` (or equivalent) from `meta.siteContext || "general"`. So when the room is a hospital room, `meta.siteContext` is e.g. `'hospital_plastic_surgery'` and that value is passed as `siteContext` into both fastTranslate and hqTranslate.
- **opts.contextInject:** Sometimes `{ contextInject: meta.contextInject }` is passed. That allows non-hospital rooms to still get medical-style prompt if the room has contextInject set.

**Both room types use both functions:** In the one-to-one path, the flow is: fastTranslate (draft) → emit receive-message → then hqTranslate → emit revise-message (and optionally update DB). So **both** normal and hospital one-to-one rooms use **both** fastTranslate and hqTranslate; there is no “hospital uses only hq” or “normal uses only fast” branch.

---

## 3. STT TRANSLATION PATH

### 3.1 stt:segment_end

- **System prompt:** Built inside fastTranslate/hqTranslate via `buildSystemPrompt(from, to, ctx, siteContext, opts)`.  
- **siteContext:** `siteCtx = meta.siteContext || "general"` (server.js ~3324). So when the room is a hospital room, `meta.siteContext` is e.g. `'hospital_plastic_surgery'` and the **same** buildSystemPrompt branch (hospital/medical) is used.
- **Difference by room type:** Yes. For hospital rooms `meta.siteContext` starts with `'hospital_'`, so the system prompt is the hospital/medical one (with dept-specific SITE_CONTEXT_PROMPTS, getMedicalTermContext(dept, to), and hospital register). For normal rooms `meta.siteContext` is `'general'` or similar, so the general prompt is used.
- **Calls:** fastTranslate(..., siteCtx, roomContext, { contextInject: meta.contextInject }) and later hqTranslate(..., siteCtx, roomContext, { contextInject: meta.contextInject }). So STT translation path uses the same prompt logic as everywhere else; no separate STT-specific prompt.

### 3.2 stt:whisper

- **System prompt:** Again via fastTranslate only (no hqTranslate in the whisper path).  
- **siteContext:** `siteCtx = meta.siteContext || "general"` (server.js ~3815).  
- **Difference by room type:** Same as above: hospital rooms get hospital prompt, normal rooms get general prompt.

---

## 4. send-message TRANSLATION PATH

- **siteContext:** `siteCtx = meta.siteContext || "general"` (server.js ~3901).  
- **System prompt:** Same buildSystemPrompt via fastTranslate and hqTranslate. So when the room is hospital (meta.siteContext like `'hospital_plastic_surgery'`), the system prompt is the hospital/medical one; otherwise general.  
- **Difference by room type:** Yes — same as stt:segment_end and stt:whisper; no separate logic for send-message. The only variable is `meta.siteContext` (and optional meta.contextInject).

---

## 5. SUMMARY TABLE

| Aspect | Normal Room | Hospital Room |
|--------|-------------|---------------|
| **System prompt** | General MONO interpreter prompt: casual messenger, slang, tone preservation, “Domain: General workplace”. | Dept-specific SITE_CONTEXT_PROMPTS (e.g. plastic surgery), medical glossary from getMedicalTermContext(dept, toLang), professional medical tone, “MUST use provided translations”, plus Hospital Mode Language Register (formal/honorific in all languages). |
| **Medical terms** | None. No call to getMedicalTermContext. | getMedicalTermContext(dept, toLang) with dept derived from siteContext (e.g. hospital_plastic_surgery → plastic_surgery). DEPT_TERM_MAP[dept] (e.g. COMMON_HOSPITAL + PLASTIC_SURGERY + …) formatted as “- ko = target” lines. |
| **fastTranslate model** | gpt-4o | gpt-4o |
| **hqTranslate model** | gpt-4o | gpt-4o |
| **Temperature** | 0.3 (both fast and hq) | 0.3 (both fast and hq) |
| **Context window** | recentContext = conversationHistory.slice(-MAX_CONTEXT_MESSAGES) with MAX_CONTEXT_MESSAGES = 10; max_tokens 1024. | Same: MAX_CONTEXT_MESSAGES = 10, max_tokens 1024. |
| **Use of fastTranslate** | Yes (draft). | Yes (draft). |
| **Use of hqTranslate** | Yes (refinement + revise-message). | Yes (refinement + revise-message; + hospital_messages UPDATE when applicable). |

---

## 6. CODE REFERENCES (line numbers approximate)

| Item | File | Line(s) |
|------|------|--------|
| buildSystemPrompt | server.js | 1695–1765 |
| isHospitalContext | server.js | 1691–1693 |
| SITE_CONTEXT_PROMPTS.general | server.js | 576 |
| SITE_CONTEXT_PROMPTS.hospital_plastic_surgery | server.js | 590 |
| getMedicalTermContext call | server.js | 1702 |
| getMedicalTermContext definition | server/constants/medicalKnowledge.js | 372–396 |
| DEPT_TERM_MAP (plastic_surgery) | server/constants/medicalKnowledge.js | 350 |
| fastTranslate | server.js | 1893–1945 |
| hqTranslate | server.js | 1948–1977 |
| MAX_CONTEXT_MESSAGES | server.js | 1457 |
| stt:segment_end siteCtx | server.js | 3324 |
| stt:whisper siteCtx | server.js | 3815 |
| send-message siteCtx | server.js | 3901 |

---

*Audit only; no files modified.*
