import React, { useState, useCallback } from 'react';

export default function PatientIdentifierLookup({ orgCode, onPatientFound }) {
  const [expanded, setExpanded] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [found, setFound] = useState(false);
  const [patient, setPatient] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en');
  const [error, setError] = useState('');

  const handleSearch = useCallback(async () => {
    const trimmed = identifier.trim();
    if (!trimmed || trimmed.length < 2) {
      setError('\uC2DD\uBCC4\uBC88\uD638\uB97C 2\uC790 \uC774\uC0C1 \uC785\uB825\uD558\uC138\uC694');
      return;
    }
    if (!orgCode) {
      setError('\uBCD1\uC6D0 \uCF54\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4');
      return;
    }

    setLoading(true);
    setError('');
    setSearchDone(false);
    setFound(false);
    setPatient(null);
    setSessions([]);

    try {
      const res = await fetch(
        `/api/hospital/patient-by-identifier/${encodeURIComponent(trimmed)}?org_code=${encodeURIComponent(orgCode)}`
      );
      if (!res.ok) throw new Error(`\uC11C\uBC84 \uC624\uB958 (${res.status})`);
      const data = await res.json();
      setSearchDone(true);

      if (data.found && data.patient) {
        setFound(true);
        setPatient(data.patient);
        try {
          const sessRes = await fetch(`/api/hospital/patient/lookup-or-create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patient_identifier: trimmed, org_code: orgCode }),
          });
          if (sessRes.ok) {
            const sessData = await sessRes.json();
            setSessions(sessData.sessions || []);
            setPatient(sessData.patient || data.patient);
            if (onPatientFound) onPatientFound(sessData);
          }
        } catch (_) {}
      } else {
        setFound(false);
      }
    } catch (err) {
      console.error('[PatientIdentifierLookup] Search error:', err);
      setError(err.message || '\uC870\uD68C \uC2E4\uD328');
    } finally {
      setLoading(false);
    }
  }, [identifier, orgCode, onPatientFound]);

  const handleRegister = useCallback(async () => {
    const trimmed = identifier.trim();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('\uD658\uC790 \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/hospital/patient/lookup-or-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_identifier: trimmed,
          org_code: orgCode,
          name: trimmedName,
          language: language,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `\uC11C\uBC84 \uC624\uB958 (${res.status})`);
      }
      const data = await res.json();
      setFound(true);
      setPatient(data.patient);
      setSessions(data.sessions || []);
      if (onPatientFound) onPatientFound(data);
    } catch (err) {
      console.error('[PatientIdentifierLookup] Register error:', err);
      setError(err.message || '\uB4F1\uB85D \uC2E4\uD328');
    } finally {
      setLoading(false);
    }
  }, [identifier, orgCode, name, language, onPatientFound]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !loading) handleSearch();
  }, [handleSearch, loading]);

  const handleClear = useCallback(() => {
    setIdentifier('');
    setSearchDone(false);
    setFound(false);
    setPatient(null);
    setSessions([]);
    setName('');
    setLanguage('en');
    setError('');
  }, []);

  const LANG_OPTIONS = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '\u4E2D\u6587' },
    { code: 'ja', label: '\u65E5\u672C\u8A9E' },
    { code: 'vi', label: 'Ti\u1EBFng Vi\u1EC7t' },
    { code: 'th', label: '\u0E44\u0E17\u0E22' },
    { code: 'ru', label: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439' },
    { code: 'mn', label: '\u041C\u043E\u043D\u0433\u043E\u043B' },
    { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629' },
  ];

  // Badge text when collapsed and patient is found
  const badgeText = found && patient
    ? `${patient.chart_number}${patient.name ? ' \u00B7 ' + patient.name : ''}`
    : null;

  return (
    <div style={{
      background: '#f8f9fa',
      borderRadius: '8px',
      border: '1px solid #e9ecef',
      marginBottom: '8px',
      overflow: 'hidden',
    }}>
      {/* Toggle header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px' }}>{'\uD83C\uDD94'}</span>
          <span style={{ fontSize: '13px', fontWeight: '600', color: '#495057' }}>
            {'\uD658\uC790 \uC2DD\uBCC4\uBC88\uD638'}
          </span>
          {!expanded && badgeText && (
            <span style={{
              fontSize: '12px',
              color: '#1971c2',
              background: '#d0ebff',
              padding: '2px 8px',
              borderRadius: '10px',
              fontWeight: '500',
            }}>
              {badgeText}
            </span>
          )}
        </div>
        <span style={{ fontSize: '12px', color: '#adb5bd', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▼
        </span>
      </div>

      {/* Expandable body */}
      {expanded && (
        <div style={{ padding: '0 12px 10px 12px' }}>
          {/* Search row */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: searchDone || error ? '6px' : '0' }}>
            <input
              type="text"
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setSearchDone(false); setFound(false); setError(''); }}
              onKeyDown={handleKeyDown}
              placeholder={'\uC5EC\uAD8C\uBC88\uD638 / \uC608\uC57D\uBC88\uD638'}
              disabled={loading}
              autoFocus
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid #dee2e6',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSearch}
              disabled={loading || !identifier.trim()}
              style={{
                padding: '7px 14px',
                borderRadius: '6px',
                border: 'none',
                background: loading ? '#adb5bd' : '#4A90D9',
                color: 'white',
                fontSize: '13px',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '...' : '\uC870\uD68C'}
            </button>
            {(searchDone || identifier) && (
              <button
                onClick={handleClear}
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #dee2e6',
                  background: 'white',
                  color: '#868e96',
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                {'\uCD08\uAE30\uD654'}
              </button>
            )}
          </div>

          {/* Error */}
          {error && (
            <div style={{ color: '#e03131', fontSize: '12px', padding: '4px 8px', background: '#fff5f5', borderRadius: '4px' }}>
              {error}
            </div>
          )}

          {/* Found: existing patient */}
          {searchDone && found && patient && (
            <div style={{ padding: '6px 10px', borderRadius: '6px', background: '#e7f5ff', border: '1px solid #a5d8ff' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#1971c2', marginBottom: '2px' }}>
                {'\uD83D\uDD04 \uC7AC\uBC29\uBB38 \uD658\uC790'}
              </div>
              <div style={{ fontSize: '12px', color: '#495057' }}>
                <strong>PT:</strong> {patient.chart_number}
                {patient.name && <span style={{ marginLeft: '8px' }}><strong>{'\uC774\uB984'}:</strong> {patient.name}</span>}
                {patient.language && <span style={{ marginLeft: '8px' }}><strong>{'\uC5B8\uC5B4'}:</strong> {patient.language}</span>}
                {sessions.length > 0 && <span style={{ marginLeft: '8px' }}><strong>{'\uC774\uC804'}:</strong> {sessions.length}{'\uAC74'}</span>}
              </div>
            </div>
          )}

          {/* Not found: registration form */}
          {searchDone && !found && (
            <div style={{ padding: '6px 10px', borderRadius: '6px', background: '#fff9db', border: '1px solid #ffe066' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#e67700', marginBottom: '4px' }}>
                {'\uC2E0\uADDC \uD658\uC790 \u2014 \uC815\uBCF4 \uC785\uB825'}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleRegister(); }}
                  placeholder={'\uD658\uC790 \uC774\uB984 (English)'}
                  disabled={loading}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid #dee2e6',
                    fontSize: '13px',
                    outline: 'none',
                  }}
                />
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={loading}
                  style={{ padding: '6px', borderRadius: '6px', border: '1px solid #dee2e6', fontSize: '12px', background: 'white' }}
                >
                  {LANG_OPTIONS.map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleRegister}
                  disabled={loading || !name.trim()}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '6px',
                    border: 'none',
                    background: loading ? '#adb5bd' : '#2f9e44',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: loading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loading ? '...' : '\uB4F1\uB85D'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
