import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function HospitalConversations() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orgCode = searchParams.get('org');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/hospital/sessions?org=${orgCode}&limit=50`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setSessions(data.sessions || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [orgCode]);

  const getFlagImg = (lang) => {
    if (!lang) return null;
    const n = lang.toString().toLowerCase().replace(/[^a-z]/g, '');
    const map = { 'kor':'kr','ko':'kr','eng':'us','en':'us','jpn':'jp','ja':'jp','chn':'cn','zh':'cn','vie':'vn','vi':'vn','tha':'th','th':'th','rus':'ru','ru':'ru','spa':'es','es':'es','fra':'fr','fr':'fr','ara':'sa','ar':'sa','deu':'de','de':'de','por':'br','pt':'br','ita':'it','it':'it','ind':'id','id':'id','hin':'in','hi':'in' };
    const code = map[n];
    if (!code) return null;
    return <img src={`https://flagcdn.com/20x15/${code}.png`} alt={code} style={{ width:20, height:15, borderRadius:2, verticalAlign:'middle', marginRight:4 }} />;
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000) return d.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'});
    if (diff < 172800000) return '\uC5B4\uC81C';
    return d.toLocaleDateString('ko-KR', {month:'short', day:'numeric'});
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', minHeight: '100vh', background: '#fff' }}>
      <div style={{ display:'flex', alignItems:'center', padding:'0 16px', height:56, borderBottom:'1px solid #f3f4f6', position:'sticky', top:0, background:'#fff', zIndex:10 }}>
        <button onClick={() => navigate(-1)} style={{ background:'none', border:'none', cursor:'pointer', padding:'8px 8px 8px 0', color:'#374151', fontSize:18 }}>
          {"\u2190"}
        </button>
        <h1 style={{ flex:1, textAlign:'center', fontSize:17, fontWeight:700, color:'#1f2937', margin:0 }}>{"\uD658\uC790 \uB300\uD654\uD568"}</h1>
        <div style={{ width:32 }} />
      </div>

      {loading ? (
        <div style={{ textAlign:'center', padding:40, color:'#9ca3af' }}>{"\uBD88\uB7EC\uC624\uB294 \uC911..."}</div>
      ) : sessions.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, color:'#9ca3af' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>{"\uD83D\uDCAC"}</div>
          <div>{"\uC774\uC804 \uB300\uD654\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4"}</div>
        </div>
      ) : (
        <div>
          {sessions.map((s, i) => (
            <div key={s.id || i}
              onClick={() => navigate(`/fixed-room/${s.room_id}`, { state: { isCreator: true, roleHint: 'owner', siteContext: 'hospital_reception', fromHistory: true } })}
              style={{ display:'flex', alignItems:'center', padding:'14px 16px', borderBottom:'1px solid #f9fafb', cursor:'pointer', gap:12 }}
            >
              <div style={{ width:44, height:44, borderRadius:'50%', background:'linear-gradient(135deg,#7C6FEB,#F472B6)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize:14, flexShrink:0 }}>
                {(s.patient_token || 'PT').slice(-4)}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                  <span style={{ fontWeight:600, fontSize:15, color:'#1f2937' }}>{s.patient_token || '\uC54C \uC218 \uC5C6\uC74C'}</span>
                  {getFlagImg(s.guest_lang)}
                  <span style={{ fontSize:12, color:'#9ca3af' }}>{(s.guest_lang||'').toUpperCase()}</span>
                </div>
                <div style={{ fontSize:13, color:'#6b7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {s.last_message || '\uB300\uD654 \uAE30\uB85D \uC5C6\uC74C'}
                </div>
              </div>
              <div style={{ fontSize:12, color:'#9ca3af', flexShrink:0 }}>{formatTime(s.ended_at || s.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
