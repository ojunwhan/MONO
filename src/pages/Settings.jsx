import React, { useCallback, useEffect, useMemo, useState } from "react";
import { clearMyIdentity, clearQueue, getMyIdentity, getStorageUsage, setMyIdentity } from "../db";
import { clearAllHistory } from "../utils/ChatStorage";
import { LANGUAGE_PROFILES, getLanguageProfileByCode } from "../constants/languageProfiles";
import { useNavigate } from "react-router-dom";

export default function SettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [form, setForm] = useState({
    nickname: "",
    monoId: "",
    nativeLanguage: "ko",
    phoneNumber: "",
    statusMessage: "",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [subscription, setSubscription] = useState(null);
  const [darkMode, setDarkMode] = useState(
    typeof window !== "undefined" && localStorage.getItem("mono.theme") === "dark"
  );
  const [preferredLang, setPreferredLang] = useState(localStorage.getItem("mono.preferredLang") || "en");
  const [uiLang, setUiLang] = useState(localStorage.getItem("mono.uiLang") || "ko");
  const [ttsVoice, setTtsVoice] = useState(localStorage.getItem("mono.tts.voice") || "female");
  const [ttsSpeed, setTtsSpeed] = useState(Number(localStorage.getItem("mono.tts.speed") || "1"));
  const [autoPlay, setAutoPlay] = useState(localStorage.getItem("mono.tts.autoplay") !== "0");
  const [micSensitivity, setMicSensitivity] = useState(Number(localStorage.getItem("mono.mic.sensitivity") || "60"));
  const [fontSize, setFontSize] = useState(localStorage.getItem("mono.fontSize") || "보통");
  const [notifEnabled, setNotifEnabled] = useState(localStorage.getItem("mono.notif.enabled") !== "0");
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("mono.notif.sound") !== "0");
  const [vibrationEnabled, setVibrationEnabled] = useState(localStorage.getItem("mono.notif.vibration") !== "0");
  const [storageUsage, setStorageUsage] = useState({ usageMB: 0, quotaMB: 0 });

  const authFetch = useCallback(async (url, options = {}) => {
    return fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const meRes = await authFetch("/api/auth/me");
        if (!meRes.ok) {
          if (!cancelled) setIsAuthenticated(false);
          return;
        }
        const data = await meRes.json();
        const user = data?.user;
        if (!user) {
          if (!cancelled) setIsAuthenticated(false);
          return;
        }
        if (cancelled) return;
        setIsAuthenticated(true);
        try {
          const subRes = await authFetch("/api/subscription/me");
          if (subRes.ok) {
            const subData = await subRes.json();
            setSubscription(subData?.subscription || null);
          }
        } catch {}
        setForm({
          nickname: user.nickname || "",
          monoId: user.monoId || "",
          nativeLanguage: user.nativeLanguage || "ko",
          phoneNumber: user.phoneNumber || "",
          statusMessage: user.statusMessage || "",
        });
        await setMyIdentity({
          userId: user.id,
          canonicalName: user.nickname || "MONO User",
          lang: user.nativeLanguage || "ko",
        });
      } catch {
        if (!cancelled) setIsAuthenticated(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  const onChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveProfile = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === "mono_id_taken") {
          setError("이미 사용 중인 MONO ID입니다.");
        } else if (data?.error === "invalid_mono_id") {
          setError("MONO ID는 영문/숫자/._- 만 사용할 수 있습니다.");
        } else {
          setError("프로필 저장에 실패했습니다.");
        }
        return;
      }
      const user = data?.user;
      if (user?.id) {
        await setMyIdentity({
          userId: user.id,
          canonicalName: user.nickname || "MONO User",
          lang: user.nativeLanguage || "ko",
        });
      } else {
        const local = await getMyIdentity();
        if (local?.userId) {
          await setMyIdentity({
            userId: local.userId,
            canonicalName: form.nickname || local.canonicalName || "MONO User",
            lang: form.nativeLanguage || local.lang || "ko",
          });
        }
      }
      setMessage("저장되었습니다.");
    } catch {
      setError("프로필 저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const doLogout = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    await clearMyIdentity().catch(() => {});
    setIsAuthenticated(false);
    setSaving(false);
    setMessage("로그아웃되었습니다.");
  };

  const clearLocalData = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await clearQueue();
      clearAllHistory();
      setMessage("로컬 저장 데이터가 정리되었습니다.");
    } catch {
      setError("로컬 데이터 정리에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      setError("이 브라우저는 알림을 지원하지 않습니다.");
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      setMessage(
        perm === "granted"
          ? "알림이 허용되었습니다."
          : perm === "denied"
          ? "알림이 차단되었습니다."
          : "알림 권한 요청이 취소되었습니다."
      );
    } catch {
      setError("알림 권한 요청에 실패했습니다.");
    }
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("mono.theme", next ? "dark" : "light");
  };

  const selectedLang = useMemo(
    () => getLanguageProfileByCode(form.nativeLanguage) || LANGUAGE_PROFILES[0],
    [form.nativeLanguage]
  );
  const usagePercent = useMemo(() => {
    if (!subscription?.monthlyLimit || subscription.monthlyLimit <= 0) return 0;
    return Math.min(100, Math.round(((subscription?.usageCount || 0) / subscription.monthlyLimit) * 100));
  }, [subscription]);
  const storagePercent = useMemo(() => {
    if (!storageUsage?.quotaMB) return 0;
    return Math.min(100, Math.round((storageUsage.usageMB / storageUsage.quotaMB) * 100));
  }, [storageUsage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    getStorageUsage()
      .then((v) => setStorageUsage(v || { usageMB: 0, quotaMB: 0 }))
      .catch(() => {});
  }, [isAuthenticated]);

  const persistToggle = (key, value, setter) => {
    setter(value);
    localStorage.setItem(key, value ? "1" : "0");
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[420px] px-4 py-6">
        <div className="mono-card p-5 text-[14px] text-[#666]">불러오는 중...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto w-full max-w-[420px] px-4 py-6 space-y-4">
        <div className="mono-card p-5">
          <h1 className="text-[18px] font-semibold">설정</h1>
          <p className="mt-2 text-[13px] text-[#666]">
            로그인하면 프로필, 언어, 저장관리, 알림 설정을 사용할 수 있습니다.
          </p>
          <div className="mt-4 space-y-2">
            <a
              href="/auth/google?next=/home"
              className="mono-btn inline-flex w-full h-[44px] px-4 items-center justify-center border border-[#111] bg-white text-[#111] font-semibold"
            >
              G Google로 계속하기
            </a>
            <a
              href="/auth/kakao?next=/home"
              className="mono-btn inline-flex w-full h-[44px] px-4 items-center justify-center border border-[#E6C200] bg-[#FEE500] text-[#191919] font-semibold"
            >
              K 카카오로 계속하기
            </a>
            <a
              href="/auth/line?next=/home"
              className="mono-btn inline-flex w-full h-[44px] px-4 items-center justify-center border border-[#06B53F] bg-[#06C755] text-white font-semibold"
            >
              L LINE으로 계속하기
            </a>
            <a
              href="/auth/apple?next=/home"
              className="mono-btn inline-flex w-full h-[44px] px-4 items-center justify-center border border-[#111] bg-[#111] text-white font-semibold"
            >
              Apple로 계속하기
            </a>
          </div>
        </div>

        <div className="mono-card p-5">
          <h2 className="text-[14px] font-semibold">앱 버전</h2>
          <p className="mt-2 text-[13px] text-[#666]">
            {import.meta.env.VITE_APP_VERSION || "1.0.0"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 py-5 space-y-4 bg-[var(--color-bg-secondary)]">
      <div className="text-[18px] font-semibold px-1">설정</div>

      <div className="mono-card p-4">
        <button type="button" onClick={() => {}} className="w-full text-left">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center text-[20px] font-semibold">
              {(form.nickname || "M").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[17px] font-semibold truncate">{form.nickname || "MONO User"}</div>
              <div className="text-[14px] text-[var(--color-text-secondary)] truncate">@{form.monoId || "mono_id"}</div>
              <div className="text-[14px] text-[var(--color-text-secondary)] truncate">{form.statusMessage || "상태메시지가 없습니다."}</div>
            </div>
          </div>
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">언어 설정</div>
        <div className="space-y-2">
          <div>
            <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">모국어</label>
            <select className="mono-input w-full h-[44px] px-3" value={form.nativeLanguage} onChange={(e) => onChange("nativeLanguage", e.target.value)}>
              {LANGUAGE_PROFILES.map((lang) => (
                <option key={lang.code} value={lang.code}>{lang.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">선호 번역 언어</label>
            <select
              className="mono-input w-full h-[44px] px-3"
              value={preferredLang}
              onChange={(e) => {
                setPreferredLang(e.target.value);
                localStorage.setItem("mono.preferredLang", e.target.value);
              }}
            >
              {LANGUAGE_PROFILES.map((lang) => (
                <option key={lang.code} value={lang.code}>{lang.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">앱 UI 언어</label>
            <select
              className="mono-input w-full h-[44px] px-3"
              value={uiLang}
              onChange={(e) => {
                setUiLang(e.target.value);
                localStorage.setItem("mono.uiLang", e.target.value);
              }}
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">음성 설정</div>
        <div>
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">TTS 음성</label>
          <select
            className="mono-input w-full h-[44px] px-3"
            value={ttsVoice}
            onChange={(e) => {
              setTtsVoice(e.target.value);
              localStorage.setItem("mono.tts.voice", e.target.value);
            }}
          >
            <option value="female">여성</option>
            <option value="male">남성</option>
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">TTS 속도 ({ttsSpeed.toFixed(1)}x)</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={ttsSpeed}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTtsSpeed(v);
              localStorage.setItem("mono.tts.speed", String(v));
            }}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">마이크 감도 ({micSensitivity})</label>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={micSensitivity}
            onChange={(e) => {
              const v = Number(e.target.value);
              setMicSensitivity(v);
              localStorage.setItem("mono.mic.sensitivity", String(v));
            }}
            className="w-full"
          />
        </div>
        <button
          type="button"
          onClick={() => persistToggle("mono.tts.autoplay", !autoPlay, setAutoPlay)}
          className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between"
        >
          <span className="text-[15px]">자동재생</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${autoPlay ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}>
            <span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${autoPlay ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
          </span>
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">표시 설정</div>
        <button
          type="button"
          onClick={toggleDarkMode}
          className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between"
        >
          <span className="text-[15px]">다크모드</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${darkMode ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}>
            <span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${darkMode ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
          </span>
        </button>
        <div>
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">글자 크기</label>
          <select
            className="mono-input w-full h-[44px] px-3"
            value={fontSize}
            onChange={(e) => {
              setFontSize(e.target.value);
              localStorage.setItem("mono.fontSize", e.target.value);
            }}
          >
            <option>작게</option>
            <option>보통</option>
            <option>크게</option>
          </select>
        </div>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">알림 설정</div>
        <button type="button" onClick={() => persistToggle("mono.notif.enabled", !notifEnabled, setNotifEnabled)} className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between">
          <span className="text-[15px]">알림</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${notifEnabled ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}><span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${notifEnabled ? "translate-x-[23px]" : "translate-x-[3px]"}`} /></span>
        </button>
        <button type="button" onClick={() => persistToggle("mono.notif.sound", !soundEnabled, setSoundEnabled)} className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between">
          <span className="text-[15px]">소리</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${soundEnabled ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}><span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${soundEnabled ? "translate-x-[23px]" : "translate-x-[3px]"}`} /></span>
        </button>
        <button type="button" onClick={() => persistToggle("mono.notif.vibration", !vibrationEnabled, setVibrationEnabled)} className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between">
          <span className="text-[15px]">진동</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${vibrationEnabled ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}><span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${vibrationEnabled ? "translate-x-[23px]" : "translate-x-[3px]"}`} /></span>
        </button>
        <button type="button" onClick={requestNotificationPermission} className="mono-btn h-[40px] px-4 border border-[var(--color-border)] bg-[var(--color-bg)]">
          알림 권한 요청 (현재: {notificationPermission})
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">구독 관리</div>
        <p className="text-[14px]">현재 플랜: <span className="font-semibold uppercase">{subscription?.plan || "free"}</span></p>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          이번 달 번역: {(subscription?.usageCount ?? 0)}회{subscription?.monthlyLimit != null ? ` / ${subscription.monthlyLimit}회` : " (무제한)"}
        </p>
        <div className="h-2 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
          <div className="h-full bg-[var(--color-primary)]" style={{ width: `${usagePercent}%` }} />
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              const r = await authFetch("/api/subscription/checkout", {
                method: "POST",
                body: JSON.stringify({ plan: "pro", next: "/settings" }),
              });
              const d = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error("checkout_failed");
              if (d?.checkoutUrl) window.location.href = d.checkoutUrl;
              else setMessage("준비 중입니다.");
            } catch {
              setMessage("준비 중입니다.");
            }
          }}
          className="mono-btn w-full h-[44px] bg-[var(--color-primary)] text-white border border-[var(--color-primary)]"
        >
          Pro 업그레이드
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">저장 관리</div>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          로컬 저장량: {storageUsage?.usageMB?.toFixed?.(2) || "0.00"} MB
          {storageUsage?.quotaMB ? ` / ${storageUsage.quotaMB.toFixed(2)} MB` : ""}
        </p>
        <div className="h-2 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
          <div className="h-full bg-[var(--color-primary)]" style={{ width: `${storagePercent}%` }} />
        </div>
        <button type="button" onClick={clearLocalData} disabled={saving} className="mono-btn h-[40px] px-4 border border-[var(--color-border)] bg-[var(--color-bg)]">
          로컬 데이터 정리
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">프로필</div>
        <div className="space-y-2">
          <input className="mono-input w-full h-[44px] px-3" value={form.nickname} onChange={(e) => onChange("nickname", e.target.value)} maxLength={40} placeholder="닉네임" />
          <input className="mono-input w-full h-[44px] px-3" value={form.monoId} onChange={(e) => onChange("monoId", e.target.value.toLowerCase())} maxLength={30} placeholder="MONO ID" />
          <input className="mono-input w-full h-[44px] px-3" value={form.statusMessage} onChange={(e) => onChange("statusMessage", e.target.value)} maxLength={160} placeholder="상태 메시지" />
          <input className="mono-input w-full h-[44px] px-3" value={form.phoneNumber || ""} onChange={(e) => onChange("phoneNumber", e.target.value)} placeholder="+82..." maxLength={24} />
        </div>
        <button type="button" onClick={saveProfile} disabled={saving} className="mono-btn w-full h-[44px] bg-[var(--color-primary)] text-white border border-[var(--color-primary)]">
          프로필 저장
        </button>
      </div>

      <div className="mono-card p-4 space-y-2">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">계정</div>
        <button type="button" onClick={doLogout} disabled={saving} className="w-full text-left text-[15px] text-[#DC2626] h-[40px]">로그아웃</button>
        <button type="button" onClick={() => setMessage("준비 중입니다.")} className="w-full text-left text-[14px] text-[#DC2626] h-[36px]">계정 삭제</button>
        <button type="button" onClick={() => setMessage("준비 중입니다.")} className="w-full text-left text-[14px] text-[var(--color-text-secondary)] h-[36px]">차단 목록</button>
      </div>

      <div className="mono-card p-4 space-y-2">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">고객센터</div>
        <button
          type="button"
          onClick={() => navigate("/cs-chat")}
          className="w-full text-left h-[44px] text-[15px] inline-flex items-center justify-between"
        >
          <span>💬 MONO 도우미</span>
          <span className="text-[var(--color-text-secondary)]">›</span>
        </button>
        <a
          href="mailto:support@lingora.chat"
          className="block h-[44px] leading-[44px] text-[15px]"
        >
          📧 이메일 문의
        </a>
      </div>

      <div className="mono-card p-4 space-y-2">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">앱 정보</div>
        <a href="/terms" className="block text-[14px] text-[var(--color-text)]">이용약관</a>
        <a href="/privacy" className="block text-[14px] text-[var(--color-text)]">개인정보처리방침</a>
        <div className="text-[13px] text-[var(--color-text-secondary)]">앱 버전: {import.meta.env.VITE_APP_VERSION || "1.0.0"}</div>
      </div>

      {error ? <p className="text-[12px] text-[#DC2626]">{error}</p> : null}
      {message ? <p className="text-[12px] text-[var(--color-primary)]">{message}</p> : null}
      <div className="h-2" />
    </div>
  );
}

