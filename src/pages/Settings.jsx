import React, { useCallback, useEffect, useMemo, useState } from "react";
import { clearMyIdentity, clearQueue, getMyIdentity, setMyIdentity } from "../db";
import { clearAllHistory } from "../utils/ChatStorage";
import { LANGUAGE_PROFILES, getLanguageProfileByCode } from "../constants/languageProfiles";

export default function SettingsPage() {
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

  const selectedLang = useMemo(
    () => getLanguageProfileByCode(form.nativeLanguage) || LANGUAGE_PROFILES[0],
    [form.nativeLanguage]
  );

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
          <a
            href="/auth/google?next=/home"
            className="mono-btn mt-4 inline-flex h-[44px] px-4 items-center border border-[#111] bg-[#111] text-white"
          >
            Google 로그인
          </a>
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
    <div className="mx-auto w-full max-w-[420px] px-4 py-6 space-y-4">
      <div className="mono-card p-5">
        <h1 className="text-[18px] font-semibold">설정</h1>
        <p className="mt-1 text-[12px] text-[#666]">
          프로필 정보를 수정하고 계정을 로그아웃할 수 있습니다.
        </p>
      </div>

      <div className="mono-card p-5 space-y-3">
        <div>
          <label className="block text-[12px] text-[#666] mb-1">닉네임</label>
          <input
            className="mono-input w-full h-[44px] px-3"
            value={form.nickname}
            onChange={(e) => onChange("nickname", e.target.value)}
            maxLength={40}
          />
        </div>

        <div>
          <label className="block text-[12px] text-[#666] mb-1">MONO ID</label>
          <input
            className="mono-input w-full h-[44px] px-3"
            value={form.monoId}
            onChange={(e) => onChange("monoId", e.target.value.toLowerCase())}
            maxLength={30}
            placeholder="mono_id"
          />
        </div>

        <div>
          <label className="block text-[12px] text-[#666] mb-1">
            모국어 ({selectedLang?.shortLabel || selectedLang?.code?.toUpperCase()})
          </label>
          <select
            className="mono-input w-full h-[44px] px-3 bg-white"
            value={form.nativeLanguage}
            onChange={(e) => onChange("nativeLanguage", e.target.value)}
          >
            {LANGUAGE_PROFILES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[12px] text-[#666] mb-1">상태 메시지</label>
          <input
            className="mono-input w-full h-[44px] px-3"
            value={form.statusMessage}
            onChange={(e) => onChange("statusMessage", e.target.value)}
            maxLength={160}
          />
        </div>

        <div>
          <label className="block text-[12px] text-[#666] mb-1">전화번호 (연락처 초대용)</label>
          <input
            className="mono-input w-full h-[44px] px-3"
            value={form.phoneNumber || ""}
            onChange={(e) => onChange("phoneNumber", e.target.value)}
            placeholder="+82..."
            maxLength={24}
          />
        </div>

        {error ? <p className="text-[12px] text-[#DC2626]">{error}</p> : null}
        {message ? <p className="text-[12px] text-[#2563EB]">{message}</p> : null}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={saveProfile}
            disabled={saving}
            className="mono-btn flex-1 h-[44px] border border-[#111] bg-[#111] text-white"
          >
            저장
          </button>
          <button
            type="button"
            onClick={doLogout}
            disabled={saving}
            className="mono-btn h-[44px] px-4 border border-[#D1D5DB] bg-white text-[#111]"
          >
            로그아웃
          </button>
        </div>
      </div>

      <div className="mono-card p-5 space-y-3">
        <h2 className="text-[16px] font-semibold">저장관리</h2>
        <p className="text-[12px] text-[#666]">
          로컬 대화 기록/오프라인 전송 큐를 정리합니다.
        </p>
        <button
          type="button"
          onClick={clearLocalData}
          disabled={saving}
          className="mono-btn h-[44px] px-4 border border-[#D1D5DB] bg-white text-[#111]"
        >
          로컬 데이터 정리
        </button>
      </div>

      <div className="mono-card p-5 space-y-3">
        <h2 className="text-[16px] font-semibold">알림</h2>
        <p className="text-[12px] text-[#666]">
          현재 권한: {notificationPermission}
        </p>
        <button
          type="button"
          onClick={requestNotificationPermission}
          className="mono-btn h-[44px] px-4 border border-[#D1D5DB] bg-white text-[#111]"
        >
          알림 권한 요청
        </button>
      </div>
    </div>
  );
}

