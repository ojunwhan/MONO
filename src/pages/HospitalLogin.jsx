import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import MonoLogo from "../components/MonoLogo";

export default function HospitalLogin() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo =
    searchParams.get("redirect") ||
    (typeof window !== "undefined" && window.location.hostname.startsWith("hospital.") ? "/dashboard" : "/hospital-dashboard");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim || !password) {
      setError("이메일과 비밀번호를 입력하세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/hospital/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: emailTrim, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        navigate(redirectTo, { replace: true });
      } else {
        setError(data.message || "이메일 또는 비밀번호가 올바르지 않습니다.");
      }
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] flex items-center justify-center px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-[380px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 shadow-lg"
      >
        <div className="flex flex-col items-center mb-8">
          <MonoLogo />
          <p className="mt-4 text-sm font-semibold text-[var(--color-text)] tracking-wide">
            병원 관리자 로그인
          </p>
        </div>

        <div className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            autoComplete="email"
            className="w-full h-12 px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoComplete="new-password"
            className="w-full h-12 px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-semibold text-sm transition-all duration-150 active:scale-[0.97] active:brightness-90"
          >
            {loading ? "확인 중..." : "로그인"}
          </button>
        </div>

        <p className="mt-4 text-center text-[12px] text-[var(--color-text-secondary)]">
          {t("login.termsAgree")}{" "}
          <a href="/terms" className="underline">
            {t("login.terms")}
          </a>
          {" / "}
          <a href="/privacy" className="underline">
            {t("login.privacy")}
          </a>
        </p>

        <p className="mt-5 text-center text-[12px] text-[var(--color-text-secondary)]">
          계정이 없으신가요?{" "}
          <button type="button" onClick={() => navigate("/hospital-register")} className="text-[#2563EB] hover:underline font-medium">
            병원 등록 신청
          </button>
        </p>
        <p className="mt-3 text-center text-[11px] text-[var(--color-text-secondary)]">
          병원 대시보드 전용 로그인
        </p>
      </form>
    </div>
  );
}
