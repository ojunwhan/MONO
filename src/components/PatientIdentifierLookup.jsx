import React, { useState, useCallback } from 'react';

const VITE_SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

export default function PatientIdentifierLookup({ orgCode, onPatientFound }) {
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { status, patient, sessions }
  const [error, setError] = useState('');

  const handleLookup = useCallback(async () => {
    const trimmed = identifier.trim();
    if (!trimmed || trimmed.length < 2) {
      setError('식별번호를 2자 이상 입력하세요');
      return;
    }
    if (!orgCode) {
      setError('병원 코드가 없습니다');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch(`${VITE_SOCKET_URL}/api/hospital/patient/lookup-or-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_identifier: trimmed,
          org_code: orgCode,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `서버 오류 (${res.status})`);
      }

      const data = await res.json();
      setResult(data);

      if (onPatientFound) {
        onPatientFound(data);
      }
    } catch (err) {
      console.error('[PatientIdentifierLookup] Error:', err);
      setError(err.message || '조회 실패');
    } finally {
      setLoading(false);
    }
  }, [identifier, orgCode, onPatientFound]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !loading) {
      handleLookup();
    }
  }, [handleLookup, loading]);

  const handleClear = useCallback(() => {
    setIdentifier('');
    setResult(null);
    setError('');
  }, []);

  return (
    <div style={{
      background: '#f8f9fa',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '16px',
      border: '1px solid #e9ecef',
    }}>
      <div style={{
        fontSize: '14px',
        fontWeight: '600',
        color: '#495057',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        🆔 환자 식별번호 조회
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="여권번호 / 예약번호 입력"
          disabled={loading}
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #dee2e6',
            fontSize: '14px',
            outline: 'none',
            transition: 'border-color 0.2s',
          }}
          onFocus={(e) => e.target.style.borderColor = '#4A90D9'}
          onBlur={(e) => e.target.style.borderColor = '#dee2e6'}
        />
        <button
          onClick={handleLookup}
          disabled={loading || !identifier.trim()}
          style={{
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            background: loading ? '#adb5bd' : '#4A90D9',
            color: 'white',
            fontSize: '14px',
            fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? '조회중...' : '조회'}
        </button>
        {(result || identifier) && (
          <button
            onClick={handleClear}
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid #dee2e6',
              background: 'white',
              color: '#868e96',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            초기화
          </button>
        )}
      </div>

      {error && (
        <div style={{
          color: '#e03131',
          fontSize: '13px',
          padding: '8px 12px',
          background: '#fff5f5',
          borderRadius: '6px',
        }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{
          marginTop: '8px',
          padding: '12px',
          borderRadius: '8px',
          background: result.status === 'existing' ? '#e7f5ff' : '#ebfbee',
          border: `1px solid ${result.status === 'existing' ? '#a5d8ff' : '#b2f2bb'}`,
        }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '600',
            color: result.status === 'existing' ? '#1971c2' : '#2f9e44',
            marginBottom: '6px',
          }}>
            {result.status === 'existing' ? '🔄 재방문 환자' : '✨ 신규 환자 등록 완료'}
          </div>

          <div style={{ fontSize: '13px', color: '#495057', lineHeight: '1.6' }}>
            <div><strong>PT번호:</strong> {result.patient?.chart_number}</div>
            <div><strong>이름:</strong> {result.patient?.name || '—'}</div>
            <div><strong>언어:</strong> {result.patient?.language || '—'}</div>
            {result.patient?.first_visit_at && (
              <div><strong>첫 방문:</strong> {new Date(result.patient.first_visit_at).toLocaleDateString('ko-KR')}</div>
            )}
            {result.sessions && result.sessions.length > 0 && (
              <div style={{ marginTop: '4px' }}>
                <strong>이전 상담:</strong> {result.sessions.length}건
                {result.sessions[0]?.department && ` (최근: ${result.sessions[0].department})`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
