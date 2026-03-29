import React, { useState, useCallback } from 'react';

export default function PatientIdentifierLookup({ orgCode, onPatientFound }) {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [found, setFound] = useState(false);
  const [patient, setPatient] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleSearch = useCallback(async () => {
    const trimmed = identifier.trim();
    if (!trimmed || trimmed.length < 2) {
      setError('\uC2DD\uBCC4\uBC88\uD638\uB97C 2\uC790 \uC774\uC0C1 \uC785\uB825\uD558\uC138\uC694');
      return;
    }
    if (!orgCode) return;
    setLoading(true);
    setError('');
    setSearchDone(false);
    setFound(false);
    setPatient(null);
    setSessions([]);
    setName('');

    try {
      const res = await fetch(
        `/api/hospital/patient-by-identifier/${encodeURIComponent(trimmed)}?org_code=${encodeURIComponent(orgCode)}`
      );
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data = await res.json();
      setSearchDone(true);

      if (data.found && data.patient) {
        setFound(true);
        setPatient(data.patient);
        try {
          const sessRes = await fetch('/api/hospital/patient/lookup-or-create', {
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
      }
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [identifier, orgCode, onPatientFound]);

  const handleRegister = useCallback(async () => {
    const trimmedId = identifier.trim();
    const trimmedName = name.trim();
    if (!trimmedId || trimmedId.length < 2) {
      setError('\uC2DD\uBCC4\uBC88\uD638\uB97C \uBA3C\uC800 \uC785\uB825\uD558\uC138\uC694');
      return;
    }
    if (!trimmedName) {
      setError('\uC5EC\uAD8C \uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/hospital/patient/lookup-or-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_identifier: trimmedId,
          org_code: orgCode,
          name: trimmedName,
          language: 'en',
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${res.status})`);
      }
      const data = await res.json();
      setFound(true);
      setSearchDone(true);
      setPatient(data.patient);
      setSessions(data.sessions || []);
      if (onPatientFound) onPatientFound(data);
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }, [identifier, orgCode, name, onPatientFound]);

  const handleClear = useCallback(() => {
    setIdentifier('');
    setSearchDone(false);
    setFound(false);
    setPatient(null);
    setSessions([]);
    setName('');
    setError('');
  }, []);

  return (
    <div style={{
      background: '#f8f9fa',
      borderRadius: '8px',
      padding: '10px 14px',
      marginBottom: '8px',
      border: '1px solid #dee2e6',
      boxSizing: 'border-box',
    }}>
      {/* Row 1: Identifier search */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#495057', whiteSpace: 'nowrap' }}>
          {'\uD83C\uDD94'}
        </span>
        <input
          type="text"
          value={identifier}
          onChange={(e) => { setIdentifier(e.target.value); setSearchDone(false); setFound(false); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleSearch(); }}
          placeholder={'\uC5EC\uAD8C\uBC88\uD638 / \uC608\uC57D\uBC88\uD638'}
          disabled={loading}
          style={{ flex: 1, padding: '7px 10px', borderRadius: '6px', border: '1px solid #ced4da', fontSize: '13px', outline: 'none' }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !identifier.trim()}
          style={{
            padding: '7px 16px', borderRadius: '6px', border: 'none',
            background: loading ? '#adb5bd' : '#4A90D9', color: '#fff',
            fontSize: '13px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '...' : '\uC870\uD68C'}
        </button>
        {(searchDone || identifier) && (
          <button
            onClick={handleClear}
            style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #dee2e6', background: '#fff', color: '#868e96', fontSize: '12px', cursor: 'pointer' }}
          >
            {'\uCD08\uAE30\uD654'}
          </button>
        )}
      </div>

      {/* Row 2: Name input + Register (always visible) */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleRegister(); }}
          placeholder={'\uC5EC\uAD8C \uC774\uB984 (Last First)'}
          disabled={loading || (searchDone && found)}
          style={{
            flex: 1, padding: '7px 10px', borderRadius: '6px',
            border: '1px solid #ced4da', fontSize: '13px', outline: 'none',
            background: (searchDone && found) ? '#f1f3f5' : '#fff',
          }}
        />
        <button
          onClick={handleRegister}
          disabled={loading || !identifier.trim() || !name.trim() || (searchDone && found)}
          style={{
            padding: '7px 16px', borderRadius: '6px', border: 'none',
            background: (loading || (searchDone && found)) ? '#adb5bd' : '#2f9e44', color: '#fff',
            fontSize: '13px', fontWeight: 600, cursor: (loading || (searchDone && found)) ? 'not-allowed' : 'pointer',
          }}
        >
          {'\uB4F1\uB85D'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: '#e03131', fontSize: '12px', marginTop: '4px', padding: '2px 6px' }}>{error}</div>
      )}

      {/* Result: found patient */}
      {searchDone && found && patient && (
        <div style={{
          marginTop: '6px', padding: '6px 10px', borderRadius: '6px',
          background: '#e7f5ff', border: '1px solid #a5d8ff', fontSize: '12px', color: '#1971c2',
        }}>
          <strong>{'\uC7AC\uBC29\uBB38'}</strong>{' \u2014 '}
          PT: {patient.chart_number}
          {patient.name && <span>{' \u00B7 '}{patient.name}</span>}
          {sessions.length > 0 && <span>{' \u00B7 \uC774\uC804 '}{sessions.length}{'\uAC74'}</span>}
        </div>
      )}

      {/* Result: newly registered */}
      {searchDone && found && patient && patient.first_visit_at === patient.last_visit_at && sessions.length === 0 && (
        <div style={{
          marginTop: '4px', padding: '6px 10px', borderRadius: '6px',
          background: '#ebfbee', border: '1px solid #b2f2bb', fontSize: '12px', color: '#2f9e44',
        }}>
          {'\u2705 \uC2E0\uADDC \uB4F1\uB85D \uC644\uB8CC'} \u2014 PT: {patient.chart_number}
        </div>
      )}
    </div>
  );
}
