// src/pages/HospitalRecords.jsx — 직원용 병원 대화 기록 조회
import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import MonoLogo from "../components/MonoLogo";
import { ChevronLeft, Search, FileText, Clock, Globe, ChevronDown, ChevronUp } from "lucide-react";

export default function HospitalRecords() {
  const navigate = useNavigate();
  const [chartQuery, setChartQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [expandedSession, setExpandedSession] = useState(null);

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
              inputMode="numeric"
              pattern="[0-9]*"
              value={chartQuery}
              onChange={(e) => setChartQuery(e.target.value.replace(/\D/g, ""))}
              onKeyDown={handleKeyDown}
              placeholder="차트번호 입력"
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
            {result.patient ? (
              <div className="p-4 rounded-[16px] border border-[var(--color-border)] bg-[var(--color-bg)]">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[16px]">👤</span>
                  <h3 className="text-[14px] font-semibold">환자 정보</h3>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <span className="text-[var(--color-text-secondary)]">차트번호: </span>
                    <span className="font-medium">{result.patient.chart_number}</span>
                  </div>
                  <div>
                    <span className="text-[var(--color-text-secondary)]">언어: </span>
                    <span className="font-medium">{result.patient.language?.toUpperCase() || "-"}</span>
                  </div>
                  {result.patient.name && (
                    <div>
                      <span className="text-[var(--color-text-secondary)]">이름: </span>
                      <span className="font-medium">{result.patient.name}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-[var(--color-text-secondary)]">등록일: </span>
                    <span className="font-medium">{formatDate(result.patient.created_at)}</span>
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
                            {session.department && (
                              <span>🏥 {session.department}</span>
                            )}
                            <span className="flex items-center gap-1">
                              <Globe size={10} />
                              {session.host_lang?.toUpperCase() || "?"} ↔ {session.guest_lang?.toUpperCase() || "?"}
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
    </div>
  );
}
