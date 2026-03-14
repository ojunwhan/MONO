import { useState } from "react";
import { useNavigate } from "react-router-dom";
import MonoLogo from "../components/MonoLogo";

export default function HospitalRegister() {
  const navigate = useNavigate();

  const [hospitalName, setHospitalName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!hospitalName.trim() || !contactName.trim() || !email.trim() || !password || !confirmPassword || !phone.trim()) {
      setError("모든 항목을 입력해 주세요.");
      return;
    }
    if (password !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/hospital/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hospitalName: hospitalName.trim(),
          contactName: contactName.trim(),
          email: email.trim().toLowerCase(),
          password,
          phone: phone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setSuccess(true);
      } else {
        setError(data.error || data.message || "등록에 실패했습니다.");
      }
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-[100dvh] bg-[var(--color-bg)] flex items-center justify-center px-4">
        <div className="w-full max-w-[380px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 shadow-lg text-center">
          <div className="flex flex-col items-center mb-6">
            <MonoLogo />
          </div>
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="text-[15px] font-semibold text-[var(--color-text)] mb-2">등록 신청이 완료되었습니다.</p>
          <p className="text-[13px] text-[var(--color-text-secondary)] mb-6">검토 후 연락드리겠습니다.</p>
          <button
            type="button"
            onClick={() => navigate("/hospital-login")}
            className="w-full h-12 rounded-xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-semibold text-sm transition-all duration-150 active:scale-[0.97] active:brightness-90"
          >
            로그인 페이지로 이동
          </button>
        </div>
      </div>
    );
  }

  const inputCls = "w-full h-12 px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder-[var(--color-text-secondary)] text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]";

  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] flex items-center justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[380px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-8 shadow-lg"
      >
        <div className="flex flex-col items-center mb-8">
          <MonoLogo />
          <p className="mt-4 text-sm font-semibold text-[var(--color-text)] tracking-wide">
            병원 등록 신청
          </p>
        </div>

        <div className="space-y-3">
          <input type="text" value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} placeholder="병원명" className={inputCls} />
          <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="담당자 이름" className={inputCls} />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" autoComplete="email" className={inputCls} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 (8자 이상)" autoComplete="new-password" className={inputCls} />
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="비밀번호 확인" autoComplete="new-password" className={inputCls} />
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="연락처" className={inputCls} />

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white font-semibold text-sm transition-all duration-150 active:scale-[0.97] active:brightness-90"
          >
            {loading ? "처리 중..." : "등록 신청"}
          </button>
        </div>

        <p className="mt-5 text-center text-[12px] text-[var(--color-text-secondary)]">
          이미 계정이 있으신가요?{" "}
          <button type="button" onClick={() => navigate("/hospital-login")} className="text-[#2563EB] hover:underline font-medium">
            로그인
          </button>
        </p>
      </form>
    </div>
  );
}
