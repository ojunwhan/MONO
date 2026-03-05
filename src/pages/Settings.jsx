import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearMyIdentity, clearQueue, getMyIdentity, getStorageUsage, setMyIdentity } from "../db";
import { clearAllHistory } from "../utils/ChatStorage";
import { useNavigate } from "react-router-dom";
import LanguageSelector from "../components/LanguageSelector";
import MonoLogo from "../components/MonoLogo";
import { useTranslation } from "react-i18next";
import { startKakaoLogin } from "../auth/kakaoLogin";
import ToastMessage from "../components/ToastMessage";

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const profileEditRef = useRef(null);
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
  const [subscription, setSubscription] = useState(null);
  const [darkMode, setDarkMode] = useState(
    typeof window !== "undefined" && localStorage.getItem("mono.theme") === "dark"
  );
  const [preferredLang, setPreferredLang] = useState(localStorage.getItem("mono.preferredLang") || "en");
  const [uiLang, setUiLang] = useState(localStorage.getItem("mono.uiLang") || i18n.resolvedLanguage || "en");
  const [ttsVoice, setTtsVoice] = useState(localStorage.getItem("mono.tts.voice") || "female");
  const [ttsSpeed, setTtsSpeed] = useState(Number(localStorage.getItem("mono.tts.speed") || "1"));
  const [autoPlay, setAutoPlay] = useState(localStorage.getItem("mono.tts.autoplay") !== "0");
  const [micSensitivity, setMicSensitivity] = useState(Number(localStorage.getItem("mono.mic.sensitivity") || "60"));
  const [fontSize, setFontSize] = useState(localStorage.getItem("mono.fontSize") || "normal");
  const [notifEnabled, setNotifEnabled] = useState(localStorage.getItem("mono.notif.enabled") !== "0");
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const v = localStorage.getItem("notificationSound");
    if (v != null) return v !== "0" && v !== "false";
    return localStorage.getItem("mono.notif.sound") !== "0";
  });
  const [vibrationEnabled, setVibrationEnabled] = useState(localStorage.getItem("mono.notif.vibration") !== "0");
  const [storageUsage, setStorageUsage] = useState({ usageMB: 0, quotaMB: 0 });
  const [toast, setToast] = useState("");

  const showToast = useCallback((msg, duration = 2500) => {
    setToast(msg);
    setTimeout(() => setToast(""), duration);
  }, []);

  const authFetch = useCallback(async (url, options = {}) => {
    const { headers: extraHeaders, ...restOptions } = options;
    return fetch(url, {
      credentials: "include",
      ...restOptions,
      headers: {
        "Content-Type": "application/json",
        ...(extraHeaders || {}),
      },
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
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.error === "mono_id_taken") {
          showToast(t("settings.monoIdTaken", "이미 사용 중인 MONO ID입니다."));
        } else if (data?.error === "invalid_mono_id") {
          showToast(t("settings.invalidMonoId", "유효하지 않은 MONO ID입니다."));
        } else {
          showToast(t("common.error", "오류가 발생했습니다."));
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
      showToast(t("settings.profileSaved", "프로필이 저장되었습니다."));
    } catch (e) {
      console.error("[Settings] saveProfile error:", e);
      showToast(t("common.error", "오류가 발생했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm(t("settings.deleteAccountConfirm", "정말 계정을 삭제하시겠습니까?\n모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다."))) {
      return;
    }
    // Double confirm for safety
    if (!window.confirm(t("settings.deleteAccountFinal", "마지막 확인: 계정 삭제를 진행합니다. 정말로 삭제하시겠습니까?"))) {
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/auth/account", { method: "DELETE" });
      if (!res.ok) {
        showToast(t("common.error", "오류가 발생했습니다."));
        return;
      }
      // Clear all local data
      await clearMyIdentity().catch(() => {});
      localStorage.clear();
      sessionStorage.clear();
      try {
        const dbs = await window.indexedDB.databases?.();
        if (dbs) {
          for (const dbInfo of dbs) {
            if (dbInfo.name) window.indexedDB.deleteDatabase(dbInfo.name);
          }
        }
      } catch {}
      showToast(t("settings.accountDeleted", "계정이 삭제되었습니다."));
      setTimeout(() => {
        window.location.href = "/login";
      }, 1500);
    } catch (e) {
      console.error("[Settings] deleteAccount error:", e);
      showToast(t("common.error", "오류가 발생했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const doLogout = async () => {
    setSaving(true);
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    await clearMyIdentity().catch(() => {});
    setIsAuthenticated(false);
    setSaving(false);
    showToast(t("settings.logoutComplete", "로그아웃 되었습니다."));
  };

  const clearLocalData = async () => {
    if (!window.confirm(t("settings.dataClearConfirm", "로컬 데이터를 모두 삭제하시겠습니까?\n(설정값, 대화 기록 등이 초기화됩니다)"))) {
      return;
    }
    setSaving(true);
    try {
      await clearQueue().catch(() => {});
      clearAllHistory();
      localStorage.clear();
      sessionStorage.clear();
      // IndexedDB도 클리어
      try {
        const dbs = await window.indexedDB.databases?.();
        if (dbs) {
          for (const dbInfo of dbs) {
            if (dbInfo.name) window.indexedDB.deleteDatabase(dbInfo.name);
          }
        }
      } catch {}
      showToast(t("settings.dataClearComplete", "로컬 데이터가 초기화되었습니다."));
      // 토스트 보여준 후 새로고침하여 상태 반영
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      console.error("[Settings] clearLocalData error:", e);
      showToast(t("common.error", "오류가 발생했습니다."));
      setSaving(false);
    }
  };

  const requestNotificationPermission = async () => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      showToast(t("common.error"));
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      showToast(
        perm === "granted"
          ? t("settings.notifications")
          : perm === "denied"
          ? t("common.cancel")
          : t("settings.notifRequestCancelled", "알림 요청이 취소되었습니다.")
      );
    } catch {
      showToast(t("settings.notifRequestFailed", "알림 권한 요청에 실패했습니다."));
    }
  };

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("mono.theme", next ? "dark" : "light");
  };

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

  const persistNotificationSound = (value) => {
    setSoundEnabled(value);
    localStorage.setItem("notificationSound", value ? "1" : "0");
    localStorage.setItem("mono.notif.sound", value ? "1" : "0");
  };

  useEffect(() => {
    const normalized = String(uiLang || "en").toLowerCase().startsWith("ko") ? "ko" : "en";
    if (i18n.language !== normalized) i18n.changeLanguage(normalized);
    localStorage.setItem("mono.uiLang", normalized);
  }, [uiLang, i18n]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[420px] px-4 py-6">
        <div className="mono-card p-5 text-[14px] text-[#666]">{t("common.loading")}</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto w-full max-w-[420px] px-4 py-6 space-y-4">
        <div className="flex justify-center mb-6">
          <MonoLogo />
        </div>
        <div className="mono-card p-5">
          <h1 className="text-[18px] font-semibold">{t("nav.settings")}</h1>
          <p className="mt-2 text-[13px] text-[#666]">
            Login to manage profile, language, storage and notifications.
          </p>
          <div className="mt-4 space-y-2">
            <a
              href="/auth/google?next=/home"
              className="w-full flex items-center justify-center gap-2 py-3 border border-gray-300 rounded-xl bg-white text-[#111] font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              {t("login.googleLogin")}
            </a>
            <button
              type="button"
              onClick={() => startKakaoLogin("/home")}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#FEE500] text-[#000000D9] font-medium"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#000000" aria-hidden="true">
                <path d="M12 3C6.48 3 2 6.58 2 10.9c0 2.78 1.86 5.22 4.65 6.6-.15.53-.96 3.41-.99 3.63 0 0-.02.17.09.24.11.06.24.01.24.01.32-.04 3.7-2.44 4.28-2.86.55.08 1.13.12 1.73.12 5.52 0 10-3.58 10-7.9C22 6.58 17.52 3 12 3z"/>
              </svg>
              {t("login.kakaoLogin")}
            </button>
          </div>
        </div>

        <div className="mono-card p-5">
          <h2 className="text-[14px] font-semibold">App Version</h2>
          <p className="mt-2 text-[13px] text-[#666]">
            {import.meta.env.VITE_APP_VERSION || "1.0.0"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[480px] px-4 py-5 space-y-4 bg-[var(--color-bg-secondary)]">
      <div className="text-[18px] font-semibold px-1">{t("nav.settings")}</div>

      <div className="mono-card p-4">
        <button type="button" onClick={() => profileEditRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })} className="w-full text-left">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center text-[20px] font-semibold">
              {(form.nickname || "M").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-[17px] font-semibold truncate">{form.nickname || "MONO User"}</div>
              <div className="text-[14px] text-[var(--color-text-secondary)] truncate">@{form.monoId || "mono_id"}</div>
              <div className="text-[14px] text-[var(--color-text-secondary)] truncate">{form.statusMessage || "No status message"}</div>
            </div>
          </div>
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">{t("settings.language")}</div>
        <div className="space-y-2">
          <div>
            <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">{t("settings.language")}</label>
            <LanguageSelector
              value={form.nativeLanguage}
              onChange={(code) => onChange("nativeLanguage", code)}
              placeholder={t("languageSelector.searchPlaceholder")}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">Preferred Translation Language</label>
            <LanguageSelector
              value={preferredLang}
              onChange={(code) => {
                setPreferredLang(code);
                localStorage.setItem("mono.preferredLang", code);
              }}
              placeholder={t("languageSelector.searchPlaceholder")}
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">{t("settings.appLanguage")}</label>
            <select
              className="mono-input w-full h-[44px] px-3"
              value={uiLang}
              onChange={(e) => {
                setUiLang(e.target.value);
              }}
            >
              <option value="ko">{t("settings.korean")}</option>
              <option value="en">{t("settings.english")}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">{t("settings.voice")}</div>
        <div>
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">{t("settings.ttsVoice")}</label>
          <select
            className="mono-input w-full h-[44px] px-3"
            value={ttsVoice}
            onChange={(e) => {
              setTtsVoice(e.target.value);
              localStorage.setItem("mono.tts.voice", e.target.value);
            }}
          >
            <option value="female">{t("settings.female")}</option>
            <option value="male">{t("settings.male")}</option>
          </select>
        </div>
        <div>
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">{t("settings.ttsSpeed")} ({ttsSpeed.toFixed(1)}x)</label>
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
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">{t("settings.micSensitivity")} ({micSensitivity})</label>
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
          <span className="text-[15px]">{t("settings.autoPlay")}</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${autoPlay ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}>
            <span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${autoPlay ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
          </span>
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">{t("settings.display")}</div>
        <button
          type="button"
          onClick={toggleDarkMode}
          className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between"
        >
          <span className="text-[15px]">{t("settings.darkMode")}</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${darkMode ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}>
            <span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${darkMode ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
          </span>
        </button>
        <div>
          <label className="block text-[12px] text-[var(--color-text-secondary)] mb-1">{t("settings.fontSize")}</label>
          <select
            className="mono-input w-full h-[44px] px-3"
            value={fontSize}
            onChange={(e) => {
              setFontSize(e.target.value);
              localStorage.setItem("mono.fontSize", e.target.value);
              window.dispatchEvent(new Event("mono:fontSizeChanged"));
            }}
          >
            <option value="small">{t("settings.fontSmall")}</option>
            <option value="normal">{t("settings.fontNormal")}</option>
            <option value="large">{t("settings.fontLarge")}</option>
          </select>
        </div>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">{t("settings.notifications")}</div>
        <button type="button" onClick={() => persistToggle("mono.notif.enabled", !notifEnabled, setNotifEnabled)} className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between">
          <span className="text-[15px]">{t("settings.notifications")}</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${notifEnabled ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}><span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${notifEnabled ? "translate-x-[23px]" : "translate-x-[3px]"}`} /></span>
        </button>
        <button type="button" onClick={() => persistNotificationSound(!soundEnabled)} className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between">
          <span className="text-[15px]">{t("settings.sound")}</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${soundEnabled ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}><span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${soundEnabled ? "translate-x-[23px]" : "translate-x-[3px]"}`} /></span>
        </button>
        <button type="button" onClick={() => persistToggle("mono.notif.vibration", !vibrationEnabled, setVibrationEnabled)} className="w-full h-[48px] px-3 border border-[var(--color-border)] rounded-[12px] bg-[var(--color-bg)] flex items-center justify-between">
          <span className="text-[15px]">{t("settings.vibration")}</span>
          <span className={`relative inline-flex h-[30px] w-[50px] rounded-full transition-colors ${vibrationEnabled ? "bg-[var(--color-primary)]" : "bg-[#E5E5EA]"}`}><span className={`absolute top-[3px] h-[24px] w-[24px] rounded-full bg-white transition-transform ${vibrationEnabled ? "translate-x-[23px]" : "translate-x-[3px]"}`} /></span>
        </button>
        <button type="button" onClick={requestNotificationPermission} className="mono-btn h-[40px] px-4 border border-[var(--color-border)] bg-[var(--color-bg)]">
          {t("settings.requestNotifPermission", { status: notificationPermission })}
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">Subscription</div>
        <p className="text-[14px]">Plan: <span className="font-semibold uppercase">{subscription?.plan || "free"}</span></p>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          This month: {(subscription?.usageCount ?? 0)}{subscription?.monthlyLimit != null ? ` / ${subscription.monthlyLimit}` : " (unlimited)"}
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
              else showToast("Coming soon.");
            } catch {
              showToast("Coming soon.");
            }
          }}
          className="mono-btn w-full h-[44px] bg-[var(--color-primary)] text-white border border-[var(--color-primary)]"
        >
          Upgrade to Pro
        </button>
      </div>

      <div className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">{t("settings.storage")}</div>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Local storage: {storageUsage?.usageMB?.toFixed?.(2) || "0.00"} MB
          {storageUsage?.quotaMB ? ` / ${storageUsage.quotaMB.toFixed(2)} MB` : ""}
        </p>
        <div className="h-2 rounded-full bg-[var(--color-bg-secondary)] overflow-hidden">
          <div className="h-full bg-[var(--color-primary)]" style={{ width: `${storagePercent}%` }} />
        </div>
        <button type="button" onClick={clearLocalData} disabled={saving} className="mono-btn h-[40px] px-4 border border-[var(--color-border)] bg-[var(--color-bg)]">
          Clear Local Data
        </button>
      </div>

      <div ref={profileEditRef} className="mono-card p-4 space-y-3">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">{t("settings.profile")}</div>
        <div className="space-y-2">
          <input className="mono-input w-full h-[44px] px-3" value={form.nickname} onChange={(e) => onChange("nickname", e.target.value)} maxLength={40} placeholder="Nickname" />
          <input className="mono-input w-full h-[44px] px-3" value={form.monoId} onChange={(e) => onChange("monoId", e.target.value.toLowerCase())} maxLength={30} placeholder="MONO ID" />
          <input className="mono-input w-full h-[44px] px-3" value={form.statusMessage} onChange={(e) => onChange("statusMessage", e.target.value)} maxLength={160} placeholder="Status message" />
          <input className="mono-input w-full h-[44px] px-3" value={form.phoneNumber || ""} onChange={(e) => onChange("phoneNumber", e.target.value)} placeholder="+82..." maxLength={24} />
        </div>
        <button type="button" onClick={saveProfile} disabled={saving} className="mono-btn w-full h-[44px] bg-[var(--color-primary)] text-white border border-[var(--color-primary)]">
          {t("common.save")}
        </button>
      </div>

      <div className="mono-card p-4 space-y-2">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">{t("settings.account")}</div>
        <button type="button" onClick={doLogout} disabled={saving} className="w-full text-left text-[15px] text-[#DC2626] h-[40px]">{t("settings.logout")}</button>
        <button type="button" onClick={deleteAccount} disabled={saving} className="w-full text-left text-[14px] text-[#DC2626] h-[36px]">Delete Account</button>
        <button type="button" onClick={() => showToast("Coming soon.")} className="w-full text-left text-[14px] text-[var(--color-text-secondary)] h-[36px]">Blocked Users</button>
      </div>

      <div className="mono-card p-4 space-y-2">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">Support</div>
        <button
          type="button"
          onClick={() => navigate("/cs-chat")}
          className="w-full text-left h-[44px] text-[15px] inline-flex items-center justify-between"
        >
          <span>💬 MONO Helper</span>
          <span className="text-[var(--color-text-secondary)]">›</span>
        </button>
        <a
          href="mailto:support@lingora.chat"
          className="block h-[44px] leading-[44px] text-[15px]"
        >
          📧 Email Support
        </a>
      </div>

      <div className="mono-card p-4 space-y-2">
        <div className="text-[12px] text-[var(--color-text-secondary)] uppercase">App</div>
        <a href="/terms" className="block text-[14px] text-[var(--color-text)]">{t("login.terms")}</a>
        <a href="/privacy" className="block text-[14px] text-[var(--color-text)]">{t("login.privacy")}</a>
        <div className="text-[13px] text-[var(--color-text-secondary)]">Version: {import.meta.env.VITE_APP_VERSION || "1.0.0"}</div>
      </div>

      <div className="h-2" />

      <ToastMessage message={toast} visible={!!toast} />
    </div>
  );
}

