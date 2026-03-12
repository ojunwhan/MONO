// src/pages/HospitalRecords.jsx — 직원용 병원 대화 기록 조회
import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import MonoLogo from "../components/MonoLogo";
import { ChevronLeft, Search, FileText, Clock, Globe, ChevronDown, ChevronUp, MessageSquare, Link2 } from "lucide-react";
import { getLanguageByCode } from "../constants/languages";
import HOSPITAL_DEPARTMENTS from "../constants/hospitalDepartments";

const DEPT_MAP = {};
HOSPITAL_DEPARTMENTS.forEach((d) => { DEPT_MAP[d.id] = d; });
function getDeptLabel(id) {
  if (id == null || id === "") return "미지정";
  return DEPT_MAP[id]?.labelKo || id || "미지정";
}
function formatChartNumber(v) {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (/^PT-[A-Z0-9]{6}$/i.test(s)) return s.toUpperCase();
  const alnum = s.replace(/[^A-Za-z0-9]/g, "");
  const last6 = alnum.slice(-6).toUpperCase().padStart(6, "0").slice(-6);
  return last6 ? "PT-" + last6 : "";
}
function getLangDisplay(code) {
  const L = getLanguageByCode(code);
  return L ? `${L.flag} ${L.name}` : (code ? String(code).toUpperCase() : "-");
}

export default function HospitalRecords() {
  const navigate = useNavigate();
  const [chartQuery, setChartQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [expandedSession, setExpandedSession] = useState(null);
  const [messageModalOpen, setMessageModalOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [toast, setToast] = useState("");
  const [copyDoneSessionId, setCopyDoneSessionId] = useState(null);

  const buildSessionCopyText = useCallback((session, messagesList) => {
    const d = session.created_at ? new Date(session.created_at) : new Date();
    const dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const patientNum = session.room_id || formatChartNumber(session.chart_number) || "";
    const guestLang = getLanguageByCode(session.guest_lang)?.name || session.guest_lang || "English";
    const hostLang = getLanguageByCode(session.host_lang)?.name || session.host_lang || "Korean";
    const lines = [
      "[MONO 통역 기록]",
      `날짜: ${dateStr}`,
      `환자번호: ${patientNum}`,
      `언어: ${guestLang} → ${hostLang}`,
      "---",
    ];
    (messagesList || []).forEach((msg) => {
      if (msg.sender_role === "host") {
        if (msg.original_text) lines.push(`직원 (${hostLang}): ${msg.original_text}`);
        if (msg.translated_text) lines.push(`환자 (${guestLang}): ${msg.translated_text}`);
      } else {
        if (msg.original_text) lines.push(`환자 (${guestLang}): ${msg.original_text}`);
        if (msg.translated_text) lines.push(`직원 (${hostLang}): ${msg.translated_text}`);
      }
    });
    lines.push("---", "Powered by MONO Medical Interpreter");
    return lines.join("\n");
  }, []);

  const handleCopySession = useCallback((session, messagesList) => {
    const text = buildSessionCopyText(session, messagesList);
    navigator.clipboard.writeText(text).then(() => {
      setCopyDoneSessionId(session.id);
      setTimeout(() => setCopyDoneSessionId(null), 2000);
    }).catch(() => {});
  }, [buildSessionCopyText]);

  const handleSearch = useCallback(async () => {
    if (!chartQuery.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch(`/api/hospital/records/${encodeURIComponent(chartQuery.trim())}`);
      if (!r.ok) throw new Error("조회 실패");
      const data = await r.json();
      if (!data.success) throw new Error("조회 실패");
      setResult(data);
    } catch (e) {
      setError(e.message || "조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [chartQuery]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr);
      return d.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return dateStr; }
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return "";
    try {
      return new Date(dateStr).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch { return ""; }
  };

  const patientToken = result?.patient?.patient_token || result?.sessions?.[0]?.patient_token;
  const deptForLink = result?.sessions?.[0]?.dept || result?.patient?.dept || "reception";

  const handleSendMessage = useCallback(async () => {
    if (!patientToken || !messageText.trim()) return;
    setMessageSending(true);
    try {
      const r = await fetch(`/api/hospital/patient/${encodeURIComponent(patientToken)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: messageText.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.ok) {
        setToast("메시지가 저장되었습니다. 환자 재방문 시 표시됩니다.");
        setMessageModalOpen(false);
        setMessageText("");
      } else {
        setToast(data.message || "저장 실패");
      }
    } catch {
      setToast("전송 실패");
    } finally {
      setMessageSending(false);
      setTimeout(() => setToast(""), 3000);
    }
  }, [patientToken, messageText]);

  const handleCopyRevisitLink = useCallback(() => {
    if (!patientToken) return;
    const url = `${window.location.origin}/hospital/join/${encodeURIComponent(deptForLink)}?token=${encodeURIComponent(patientToken)}`;
    navigator.clipboard.writeText(url).then(() => {
      setToast("링크가 복사되었습니다.");
      setTimeout(() => setToast(""), 2500);
    }).catch(() => setToast("복사 실패"));
  }, [patientToken, deptForLink]);

  return (
    <div className="min-h-[100dvh] text-[var(--color-text)] bg-[var(--color-bg)]">
      <div className="mx-auto w-full max-w-[640px] px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => navigate("/hospital")}
            className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
            <MonoLogo className="text-[28px]" />
            <div>
              <h1 className="text-[16px] font-semibold">통역 기록 조회</h1>
              <p className="text-[11px] text-[var(--color-text-secondary)]">Hospital Records</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-2 mb-6">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input
              type="text"
              value={chartQuery}
              onChange={(e) => setChartQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="차트번호 또는 PT-XXXXXX 입력"
              className="w-full h-[44px] pl-10 pr-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[14px] focus:outline-none focus:border-[#3B82F6]"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading || !chartQuery.trim()}
            className="h-[44px] px-5 rounded-[12px] bg-[#3B82F6] text-white text-[14px] font-medium disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {loading ? "조회 중..." : "검색"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-[12px] bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-[13px] text-red-600 dark:text-red-400 mb-4">
            {error}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Patient Info */}
            {result.patient || (result.sessions?.length > 0) ? (
              <div className="p-4 rounded-[16px] border border-[var(--color-border)] bg-[var(--color-bg)]">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px]">👤</span>
                    <h3 className="text-[14px] font-semibold">환자 정보</h3>
                  </div>
                  {patientToken && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setMessageModalOpen(true)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-[#3B82F6] text-white"
                      >
                        <MessageSquare size={12} /> 메시지 보내기
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyRevisitLink}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-[var(--color-border)]"
                      >
                        <Link2 size={12} /> 재방문 링크
                      </button>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <span className="text-[var(--color-text-secondary)]">차트번호: </span>
                    <span className="font-medium font-mono">{result.sessions?.[0]?.room_id || formatChartNumber(result.patient?.chart_number) || "-"}</span>
                  </div>
                  {patientToken && (
                    <div>
                      <span className="text-[var(--color-text-secondary)]">환자토큰: </span>
                      <span className="font-medium font-mono text-[10px]">{String(patientToken).slice(0, 16)}…</span>
                    </div>
                  )}
                  <div>
                    <span className="text-[var(--color-text-secondary)]">언어: </span>
                    <span className="font-medium">{getLangDisplay(result.patient?.language || result.sessions?.[0]?.guest_lang)}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)]">진료과: </span>
                    <span className="font-medium">{getDeptLabel(result.sessions?.[0]?.dept || result.patient?.dept)}</span>
                  </div>
                  {result.patient?.name && (
                    <div>
                      <span className="text-[var(--color-text-secondary)]">이름: </span>
                      <span className="font-medium">{result.patient.name}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-[var(--color-text-secondary)]">등록일: </span>
                    <span className="font-medium">{formatDate(result.patient?.created_at || result.patient?.first_visit_at)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-[16px] border border-[var(--color-border)] bg-[var(--color-bg)] text-center">
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  등록된 환자 정보가 없습니다
                </p>
              </div>
            )}

            {/* Sessions */}
            <div>
              <h3 className="text-[14px] font-semibold mb-2 flex items-center gap-2">
                <FileText size={16} />
                통역 세션 ({result.sessions?.length || 0}건)
              </h3>

              {(!result.sessions || result.sessions.length === 0) ? (
                <p className="text-[13px] text-[var(--color-text-secondary)] text-center py-6">
                  통역 기록이 없습니다.
                </p>
              ) : (
                <div className="space-y-2">
                  {result.sessions.map((session) => (
                    <div key={session.id} className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
                      {/* Session Header */}
                      <button
                        type="button"
                        onClick={() => setExpandedSession(expandedSession === session.id ? null : session.id)}
                        className="w-full p-3 flex items-center gap-3 text-left hover:bg-[var(--color-bg-secondary)] transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock size={12} className="text-[var(--color-text-secondary)]" />
                            <span className="text-[12px] text-[var(--color-text-secondary)]">
                              {formatDate(session.created_at)}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                              session.status === "active"
                                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                            }`}>
                              {session.status === "active" ? "진행 중" : "종료"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)]">
                            <span>🏥 {getDeptLabel(session.department)}</span>
                            <span className="flex items-center gap-1">
                              <Globe size={10} />
                              {getLangDisplay(session.guest_lang)} → {getLangDisplay(session.host_lang)}
                            </span>
                            <span>
                              💬 {session.messages?.length || 0}건
                            </span>
                          </div>
                        </div>
                        {expandedSession === session.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>

                      {/* Messages (expanded) */}
                      {expandedSession === session.id && session.messages && (
                        <div className="border-t border-[var(--color-border)] p-3 max-h-[400px] overflow-y-auto space-y-2">
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="text-[11px] text-[var(--color-text-secondary)]">EMR / CRM / 차트 어디든 붙여넣기 가능</span>
                            <button
                              type="button"
                              onClick={() => handleCopySession(session, session.messages)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-[#3B82F6] text-white text-[12px] font-medium hover:bg-[#2563EB]"
                            >
                              {copyDoneSessionId === session.id ? "복사됨 ✓" : "📋 대화 내용 복사"}
                            </button>
                          </div>
                          {session.messages.length === 0 ? (
                            <p className="text-[12px] text-[var(--color-text-secondary)] text-center py-3">
                              대화 내용이 없습니다.
                            </p>
                          ) : (
                            session.messages.map((msg) => (
                              <div
                                key={msg.id}
                                className={`p-2 rounded-[8px] ${
                                  msg.sender_role === "host"
                                    ? "bg-blue-50 dark:bg-blue-950 border-l-2 border-blue-400"
                                    : "bg-gray-50 dark:bg-gray-900 border-l-2 border-gray-400"
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="text-[10px] font-medium">
                                    {msg.sender_role === "host" ? "🩺 의료진" : "🧑 환자"}
                                  </span>
                                  <span className="text-[9px] text-[var(--color-text-secondary)]">
                                    {msg.sender_lang?.toUpperCase()} · {formatTime(msg.created_at)}
                                  </span>
                                </div>
                                <p className="text-[12px] text-[var(--color-text)]">{msg.original_text}</p>
                                {msg.translated_text && (
                                  <p className="text-[11px] text-[#3B82F6] mt-0.5">→ {msg.translated_text}</p>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-[10px] text-[var(--color-text-secondary)]">
            Powered by MONO Medical Interpreter
          </p>
        </div>
      </div>

      {/* 메시지 보내기 모달 */}
      {messageModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-[16px] bg-[var(--color-bg)] p-4 shadow-xl">
            <h3 className="text-[16px] font-semibold mb-2">환자에게 메시지 보내기</h3>
            <p className="text-[12px] text-[var(--color-text-secondary)] mb-3">재방문 시 채널에서 확인할 수 있습니다.</p>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="메시지 입력..."
              className="w-full min-h-[100px] p-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[14px] resize-y mb-4"
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setMessageModalOpen(false); setMessageText(""); }} className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[13px]">취소</button>
              <button type="button" onClick={handleSendMessage} disabled={messageSending || !messageText.trim()} className="px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-[13px] disabled:opacity-50">{messageSending ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-[10px] bg-[#1e293b] text-white text-[13px] shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
