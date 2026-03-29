import React, { useState, useCallback } from 'react';

export default function PatientIdentifierLookup({ orgCode, onPatientFound }) {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [found, setFound] = useState(false);
  const [patient, setPatient] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
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
    setLastName('');
    setFirstName('');

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
    const trimmedLast = lastName.trim().toUpperCase();
    const trimmedFirst = firstName.trim().toUpperCase();
    if (!trimmedId || trimmedId.length < 2) {
      setError('\uC2DD\uBCC4\uBC88\uD638\uB97C \uBA3C\uC800 \uC785\uB825\uD558\uC138\uC694');
      return;
    }
    if (!trimmedLast) {
      setError('\uC131(Last Name)\uC744 \uC785\uB825\uD558\uC138\uC694');
      return;
    }
    if (!trimmedFirst) {
      setError('\uC774\uB984(First Name)\uC744 \uC785\uB825\uD558\uC138\uC694');
      return;
    }
    setLoading(true);
    setError('');

    // Combine as "LASTNAME FIRSTNAME" — matches Korean hospital passport registration format
    const fullName = `${trimmedLast} ${trimmedFirst}`;

    try {
      const res = await fetch('/api/hospital/patient/lookup-or-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_identifier: trimmedId,
          org_code: orgCode,
          name: fullName,
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
  }, [identifier, orgCode, lastName, firstName, onPatientFound]);

  const handleClear = useCallback(() => {
    setIdentifier('');
    setSearchDone(false);
    setFound(false);
    setPatient(null);
    setSessions([]);
    setLastName('');
    setFirstName('');
    setError('');
  }, []);

  const inputStyle = {
    padding: '7px 10px',
    borderRadius: '6px',
    border: '1px solid #ced4da',
    fontSize: '13px',
    outline: 'none',
  };

  const btnBlue = {
    padding: '7px 16px', borderRadius: '6px', border: 'none',
    background: '#4A90D9', color: '#fff',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  const btnGreen = {
    padding: '7px 16px', borderRadius: '6px', border: 'none',
    background: '#2f9e44', color: '#fff',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  const isRegistered = searchDone && found;

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
        <span style={{ fontSize: '14px' }}>{'\uD83C\uDD94'}</span>
        <input
          type="text"
          value={identifier}
          onChange={(e) => { setIdentifier(e.target.value); setSearchDone(false); setFound(false); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleSearch(); }}
          placeholder={'\uC5EC\uAD8C\uBC88\uD638 / \uC608\uC57D\uBC88\uD638'}
          disabled={loading}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !identifier.trim()}
          style={{ ...btnBlue, background: loading ? '#adb5bd' : '#4A90D9', cursor: loading ? 'not-allowed' : 'pointer' }}
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

      {/* Row 2: Last Name + First Name + Register */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="text"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder={'Last Name (\uC131)'}
          disabled={loading || isRegistered}
          style={{
            ...inputStyle,
            flex: 1,
            textTransform: 'uppercase',
            background: isRegistered ? '#f1f3f5' : '#fff',
          }}
        />
        <input
          type="text"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleRegister(); }}
          placeholder={'First Name (\uC774\uB984)'}
          disabled={loading || isRegistered}
          style={{
            ...inputStyle,
            flex: 1,
            textTransform: 'uppercase',
            background: isRegistered ? '#f1f3f5' : '#fff',
          }}
        />
        <button
          onClick={handleRegister}
          disabled={loading || !identifier.trim() || !lastName.trim() || !firstName.trim() || isRegistered}
          style={{
            ...btnGreen,
            background: (loading || isRegistered) ? '#adb5bd' : '#2f9e44',
            cursor: (loading || isRegistered) ? 'not-allowed' : 'pointer',
          }}
        >
          {'\uB4F1\uB85D'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: '#e03131', fontSize: '12px', marginTop: '4px', padding: '2px 6px' }}>{error}</div>
      )}

      {/* Result */}
      {isRegistered && patient && (
        <div style={{
          marginTop: '6px', padding: '6px 10px', borderRadius: '6px',
          background: sessions.length > 0 ? '#e7f5ff' : '#ebfbee',
          border: `1px solid ${sessions.length > 0 ? '#a5d8ff' : '#b2f2bb'}`,
          fontSize: '12px',
          color: sessions.length > 0 ? '#1971c2' : '#2f9e44',
        }}>
          {sessions.length > 0 ? '\uD83D\uDD04 \uC7AC\uBC29\uBB38' : '\u2705 \uC2E0\uADDC \uB4F1\uB85D'}
          {' \u2014 PT: '}{patient.chart_number}
          {patient.name && <span>{' \u00B7 '}{patient.name}</span>}
          {sessions.length > 0 && <span>{' \u00B7 \uC774\uC804 '}{sessions.length}{'\uAC74'}</span>}
        </div>
      )}
    </div>
  );
}
