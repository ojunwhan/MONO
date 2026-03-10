// src/pages/OrgSetup.jsx — 기관 가입 시 소셜 로그인 후 추가 정보 입력
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAuthMe } from "../auth/session";
import { Building2, Loader2 } from "lucide-react";

function MonoLogo() {
  return (
    <div className="text-[40px] font-bold tracking-[0.2em] leading-none">
      <span style={{ color: "#7C6FEB" }}>M</span>
      <span style={{ color: "#F472B6" }}>O</span>
      <span style={{ color: "#34D399" }}>N</span>
      <span style={{ color: "#FBBF24" }}>O</span>
    </div>
  );
}

export default function OrgSetup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [orgName, setOrgName] = useState("");
  const [businessNumber, setBusinessNumber] = useState("");
  const [contactName, setContactName] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchAuthMe();
      if (cancelled) return;
      if (!me?.authenticated) {
        navigate("/login", { replace: true });
        return;
      }
      if (me.user?.accountType === "organization" && me.user?.orgName) {
        navigate("/hospital-dashboard", { replace: true });
        return;
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const name = orgName.trim();
    const number = businessNumber.trim().replace(/\s/g, "");
    const contact = contactName.trim();
    if (!name) {
      setError("기관명을 입력하세요.");
      return;
    }
    if (!contact) {
      setError("담당자 이름을 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType: "organization",
          orgName: name,
          businessNumber: number || undefined,
          contactName: contact,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "저장에 실패했습니다.");
      }
      navigate("/hospital-dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "저장에 실패했습니다.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)] flex flex-col items-center justify-center">
        <Loader2 size={32} className="animate-spin text-[var(--color-text-secondary)]" />
        <p className="mt-4 text-[14px] text-[var(--color-text-secondary)]">확인 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-[420px] px-6 py-8 flex flex-col">
        <div className="flex flex-col items-center text-center mb-8">
          <MonoLogo />
          <span className="mt-4 flex items-center gap-2 text-[#3B82F6]">
            <Building2 size={20} />
            <span className="text-[14px] font-semibold">기관 정보 입력</span>
          </span>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
            병원·기업용 계정으로 사용할 정보를 입력하세요.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="org-name" className="block text-[13px] font-medium text-[var(--color-text)] mb-1.5">
              기관명 (병원명 등) <span className="text-red-500">*</span>
            </label>
            <input
              id="org-name"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="예: ○○병원"
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
              maxLength={120}
              autoComplete="organization"
            />
          </div>
          <div>
            <label htmlFor="business-number" className="block text-[13px] font-medium text-[var(--color-text)] mb-1.5">
              사업자번호
            </label>
            <input
              id="business-number"
              type="text"
              value={businessNumber}
              onChange={(e) => setBusinessNumber(e.target.value.replace(/[^\d\s-]/g, ""))}
              placeholder="예: 123-45-67890"
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
              maxLength={20}
            />
          </div>
          <div>
            <label htmlFor="contact-name" className="block text-[13px] font-medium text-[var(--color-text)] mb-1.5">
              담당자 이름 <span className="text-red-500">*</span>
            </label>
            <input
              id="contact-name"
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="예: 홍길동"
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
              maxLength={60}
              autoComplete="name"
            />
          </div>
          {error && (
            <p className="text-[13px] text-red-500">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 rounded-xl bg-[#3B82F6] text-white font-medium text-[15px] hover:bg-[#2563EB] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={20} className="animate-spin" /> : null}
            {submitting ? "저장 중..." : "완료하고 대시보드로 이동"}
          </button>
        </form>

        <p className="mt-8 text-center text-[11px] text-[var(--color-text-secondary)]">
          입력하시면 병원 관리 대시보드로 이동합니다.
        </p>
      </div>
    </div>
  );
}
