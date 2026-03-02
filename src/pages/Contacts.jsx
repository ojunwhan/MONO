import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";
import { getMyIdentity } from "../db";
import { getLanguageProfileByCode } from "../constants/languageProfiles";
import { UserRound, UserPlus, Phone, Send, Plus, Search, QrCode, Link2, ChevronDown, ChevronUp, ChevronLeft } from "lucide-react";
import BottomSheet from "../components/BottomSheet";
import { useTranslation } from "react-i18next";

export default function Contacts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneMembers, setPhoneMembers] = useState([]);
  const [nonMembers, setNonMembers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [requestOpen, setRequestOpen] = useState(true);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeFriend, setActiveFriend] = useState(null);

  const authFetch = useCallback(async (url, options = {}) => {
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
    return res;
  }, []);

  const loadLists = useCallback(async () => {
    try {
      const [friendsRes, reqRes] = await Promise.all([
        authFetch("/api/contacts/friends"),
        authFetch("/api/contacts/requests"),
      ]);
      if (friendsRes.ok) {
        const data = await friendsRes.json();
        setFriends(Array.isArray(data?.friends) ? data.friends : []);
      }
      if (reqRes.ok) {
        const data = await reqRes.json();
        setRequests(Array.isArray(data?.requests) ? data.requests : []);
      }
    } catch {
      setMessage(t("contacts.loadFailed"));
    }
  }, [authFetch, t]);

  useEffect(() => {
    getMyIdentity().then((identity) => {
      if (!identity?.userId) {
        navigate("/interpret", { replace: true });
        return;
      }
      setMe(identity);
    });
  }, [navigate]);

  useEffect(() => {
    if (!me?.userId) return;
    loadLists();
  }, [me?.userId, loadLists]);

  const onSearch = useCallback(async () => {
    setMessage("");
    if (query.trim().length < 2) {
      setSearchResults([]);
      setMessage(t("contacts.idMin2"));
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/contacts/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setMessage(t("contacts.searchFailed"));
        return;
      }
      setSearchResults(Array.isArray(data?.users) ? data.users : []);
      if (!data?.users?.length) setMessage(t("contacts.searchNoResult"));
    } catch {
      setMessage(t("common.error"));
    } finally {
      setBusy(false);
    }
  }, [authFetch, query, t]);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setSearchResults([]);
      setMessage("");
      return;
    }
    const timer = window.setTimeout(() => {
      onSearch();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, onSearch]);

  const sendRequest = useCallback(
    async (targetMonoId) => {
      setBusy(true);
      setMessage("");
      try {
        const res = await authFetch("/api/contacts/request", {
          method: "POST",
          body: JSON.stringify({ targetMonoId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage(t("common.error"));
          return;
        }
        setMessage(data.relation === "accepted" ? "Added" : "Requested");
        await loadLists();
        await onSearch();
      } catch {
        setMessage(t("common.error"));
      } finally {
        setBusy(false);
      }
    },
    [authFetch, loadLists, onSearch, t]
  );

  const respondRequest = useCallback(
    async (requesterUserId, action) => {
      setBusy(true);
      try {
        const res = await authFetch("/api/contacts/respond", {
          method: "POST",
          body: JSON.stringify({ requesterUserId, action }),
        });
        if (!res.ok) {
          setMessage(t("common.error"));
          return;
        }
        await loadLists();
      } catch {
        setMessage(t("common.error"));
      } finally {
        setBusy(false);
      }
    },
    [authFetch, loadLists, t]
  );

  const removeFriend = useCallback(
    async (peerUserId) => {
      setBusy(true);
      try {
        const res = await authFetch("/api/contacts/remove", {
          method: "POST",
          body: JSON.stringify({ peerUserId }),
        });
        if (!res.ok) {
          setMessage(t("common.error"));
          return;
        }
        await loadLists();
      } catch {
        setMessage(t("common.error"));
      } finally {
        setBusy(false);
      }
    },
    [authFetch, loadLists, t]
  );

  const startDm = useCallback(
    (peerUserId) => {
      if (!me?.userId) return;
      socket.emit("create-1to1", {
        myUserId: me.userId,
        peerUserId,
        siteContext: "general",
      });
      const onCreated = (payload) => {
        if (!payload?.roomId) return;
        navigate(`/room/${payload.roomId}`, {
          state: {
            fromLang: me.lang || "ko",
            localName: me.canonicalName || "",
            myUserId: me.userId,
            isCreator: true,
            roomType: payload.roomType || "1to1",
          },
        });
      };
      socket.once("room-created", onCreated);
    },
    [me, navigate]
  );

  const renderLang = useCallback((code) => {
    const p = getLanguageProfileByCode(code || "en");
    if (!p) return "EN";
    return p.shortLabel || p.code.toUpperCase();
  }, []);

  const pendingCount = useMemo(() => requests.length, [requests.length]);
  const sortedFriends = useMemo(
    () =>
      [...friends].sort((a, b) =>
        String(a?.nickname || a?.monoId || "").localeCompare(String(b?.nickname || b?.monoId || ""), "ko")
      ),
    [friends]
  );
  const filteredSearchResults = useMemo(
    () => searchResults.filter((u) => String(u?.id || "") !== String(me?.userId || "")),
    [searchResults, me?.userId]
  );
  const groupedFriends = useMemo(() => {
    const group = new Map();
    for (const f of sortedFriends) {
      const base = String(f?.nickname || f?.monoId || "").trim();
      const key = (base.charAt(0) || "#").toUpperCase();
      if (!group.has(key)) group.set(key, []);
      group.get(key).push(f);
    }
    return Array.from(group.entries()).sort(([a], [b]) => a.localeCompare(b, "ko"));
  }, [sortedFriends]);
  const supportsContactPicker =
    typeof navigator !== "undefined" &&
    !!navigator.contacts &&
    typeof navigator.contacts.select === "function";

  const lookupPhones = useCallback(
    async (phones) => {
      setBusy(true);
      setMessage("");
      setPhoneMembers([]);
      setNonMembers([]);
      try {
        const cleaned = (phones || [])
          .map((p) => String(p || "").replace(/[^\d+]/g, "").trim())
          .filter((p) => p.length >= 8);
        if (!cleaned.length) {
          setMessage(t("common.error"));
          return;
        }
        const res = await authFetch("/api/contacts/lookup-phone", {
          method: "POST",
          body: JSON.stringify({ phones: cleaned }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage(t("common.error"));
          return;
        }
        setPhoneMembers(Array.isArray(data?.members) ? data.members : []);
        setNonMembers(Array.isArray(data?.nonMembers) ? data.nonMembers : []);
        if (!data?.members?.length && !data?.nonMembers?.length) {
          setMessage(t("contacts.searchNoResult"));
        }
      } catch {
        setMessage(t("common.error"));
      } finally {
        setBusy(false);
      }
    },
    [authFetch, t]
  );

  const pickContacts = useCallback(async () => {
    if (!supportsContactPicker) return;
    try {
      const selected = await navigator.contacts.select(["tel", "name"], {
        multiple: true,
      });
      const phones = selected
        .flatMap((c) => c?.tel || [])
        .filter(Boolean);
      await lookupPhones(phones);
    } catch {
      setMessage(t("common.error"));
    }
  }, [lookupPhones, supportsContactPicker, t]);

  const lookupManualPhone = useCallback(async () => {
    await lookupPhones([phoneInput]);
  }, [lookupPhones, phoneInput]);

  return (
    <div className="mx-auto w-full max-w-[480px] min-h-screen bg-[var(--color-bg)] pb-20">
      <div className="h-[52px] px-4 border-b border-[var(--color-border)] flex items-center justify-between">
        <h1 className="text-[18px] font-semibold">{t("nav.contacts")}</h1>
        <button
          type="button"
          onClick={() => setShowAddSheet(true)}
          className="w-10 h-10 flex items-center justify-center text-[var(--color-text)]"
          aria-label={t("contacts.addContact")}
        >
          <Plus size={22} />
        </button>
      </div>

      <div className="sticky top-0 z-20 bg-[var(--color-bg)] px-4 py-3 border-b border-[var(--color-border)]">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            placeholder={t("contacts.searchMonoId")}
            className="w-full h-[40px] pl-9 pr-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[14px]"
          />
        </form>
        {(searchFocused || query.trim()) && (
          <div className="absolute left-4 right-4 top-[58px] max-h-[280px] overflow-y-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-bg)] shadow-lg">
            {filteredSearchResults.length === 0 ? (
              <div className="px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">{t("contacts.noContacts")}</div>
            ) : (
              filteredSearchResults.map((u) => (
                <div key={`search-${u.id}`} className="px-4 py-3 border-b last:border-b-0 border-[var(--color-border)] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium truncate">{u.nickname || t("contacts.unknownUser")}</div>
                    <div className="text-[12px] text-[var(--color-text-secondary)] truncate">@{u.monoId} · {renderLang(u.nativeLanguage)}</div>
                  </div>
                  {u.relation === "accepted" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchFocused(false);
                        startDm(u.id);
                      }}
                      className="mono-btn h-[34px] px-3 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-[12px]"
                    >
                      {t("nav.chat")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendRequest(u.monoId)}
                      className="mono-btn h-[34px] px-3 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-[12px]"
                    >
                      {u.relation === "pending_sent" ? t("common.save") : t("contacts.addContact")}
                    </button>
                  )}
                </div>
              ))
            )}
            <button
              type="button"
              onClick={() => setSearchFocused(false)}
              className="w-full py-2 text-[12px] text-[var(--color-text-secondary)] border-t border-[var(--color-border)]"
            >
              {t("common.close")}
            </button>
          </div>
        )}
        {message ? <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">{message}</p> : null}
      </div>

      <div className="px-4 pt-4 space-y-4">
        {pendingCount > 0 && (
          <div className="mono-card p-4">
            <button
              type="button"
              onClick={() => setRequestOpen((v) => !v)}
              className="w-full flex items-center justify-between"
            >
              <h2 className="text-[14px] font-semibold">Friends Request ({pendingCount})</h2>
              {requestOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {requestOpen && (
              <div className="mt-3 space-y-2">
                {requests.map((u) => (
                  <div key={`req-${u.id}`} className="border border-[var(--color-border)] rounded-[10px] p-3">
                    <div className="text-[14px] font-medium">{u.nickname || t("contacts.unknownUser")}</div>
                    <div className="text-[12px] text-[var(--color-text-secondary)]">@{u.monoId} · {renderLang(u.nativeLanguage)}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => respondRequest(u.id, "accept")}
                        className="mono-btn h-[34px] px-3 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-[12px]"
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        type="button"
                        onClick={() => respondRequest(u.id, "reject")}
                        className="mono-btn h-[34px] px-3 border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-[12px]"
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mono-card p-0 overflow-hidden">
          <div className="px-4 pt-4 pb-2 text-[14px] font-semibold">{t("contacts.monoFriends")} ({sortedFriends.length})</div>
          {sortedFriends.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] flex items-center justify-center">
                <UserRound size={24} />
              </div>
              <p className="mt-4 text-[16px] text-[var(--color-text)]">{t("contacts.noContacts")}</p>
              <button
                type="button"
                onClick={() => setShowAddSheet(true)}
                className="mono-btn mt-5 h-[40px] px-4 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-[14px]"
              >
                {t("contacts.addContact")}
              </button>
            </div>
          ) : (
            <div>
              {groupedFriends.map(([section, users]) => (
                <div key={`sec-${section}`}>
                  <div className="h-[28px] px-4 text-[12px] font-semibold text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] flex items-center">
                    {section}
                  </div>
                  {users.map((u) => (
                    <button
                      key={`friend-${u.id}`}
                      type="button"
                      onClick={() => setActiveFriend(u)}
                      className="relative w-full h-[72px] px-4 flex items-center justify-between gap-2 text-left hover:bg-[var(--color-bg-secondary)]"
                    >
                      <span className="absolute left-[68px] right-0 top-0 h-px bg-[var(--color-border)]" />
                      <div className="min-w-0 flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center text-[14px] font-semibold text-[var(--color-text)]">
                          {(u.nickname || "M").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[15px] font-medium truncate">{u.nickname || t("contacts.unknownUser")}</div>
                          <div className="text-[13px] text-[var(--color-text-secondary)] truncate">
                            {u.statusMessage || `@${u.monoId}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-[12px] text-[var(--color-text-secondary)]">{renderLang(u.nativeLanguage)}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mono-card p-4">
          <h2 className="text-[14px] font-semibold flex items-center gap-2">
            <Phone size={15} /> {t("contacts.inviteFromContacts")}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">
            {t("contacts.inviteFromContactsDesc")}
          </p>

          {supportsContactPicker ? (
            <button
              type="button"
              onClick={pickContacts}
              disabled={busy}
              className="mono-btn mt-3 h-[44px] px-4 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
            >
              {t("contacts.inviteFromContacts")}
            </button>
          ) : (
            <div className="mt-3 flex gap-2">
              <input
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder={t("contacts.phonePlaceholder")}
                className="mono-input flex-1 h-[44px] px-3"
              />
              <button
                type="button"
                onClick={lookupManualPhone}
                disabled={busy}
                className="mono-btn h-[44px] px-4 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
              >
                {t("contacts.search")}
              </button>
            </div>
          )}

          <div className="mt-3 space-y-2">
            {phoneMembers.map((u) => (
              <div key={`phone-member-${u.id}`} className="border border-[var(--color-border)] rounded-[10px] p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium truncate">{u.nickname || t("contacts.unknownUser")}</div>
                  <div className="text-[12px] text-[var(--color-text-secondary)] truncate">@{u.monoId} · {u.phoneNumber}</div>
                </div>
                <button
                  type="button"
                  onClick={() => sendRequest(u.monoId)}
                  className="mono-btn h-[34px] px-3 border border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-[12px]"
                >
                  {t("contacts.addContact")}
                </button>
              </div>
            ))}

            {nonMembers.map((phone) => (
              <div key={`non-member-${phone}`} className="border border-[var(--color-border)] rounded-[10px] p-3 flex items-center justify-between gap-2">
                <div className="text-[13px] text-[var(--color-text-secondary)] truncate">{phone}</div>
                <button
                  type="button"
                  onClick={() => {
                    const inviteUrl = `${window.location.origin}/interpret`;
                    const smsUrl = `sms:${phone}?body=${encodeURIComponent(`MONO Invite Link: ${inviteUrl}`)}`;
                    window.location.href = smsUrl;
                  }}
                  className="mono-btn h-[34px] px-3 border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] inline-flex items-center gap-1 text-[12px]"
                >
                  <Send size={13} /> {t("contacts.inviteFromContacts")}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BottomSheet open={showAddSheet} onClose={() => setShowAddSheet(false)}>
          <div className="p-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center">
              <button
                type="button"
                onClick={() => setShowAddSheet(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center text-[var(--color-text)]"
                aria-label={t("common.back")}
              >
                <ChevronLeft size={22} />
              </button>
              <div className="ml-1 text-[15px] font-semibold">{t("contacts.addContact")}</div>
            </div>
            <div className="space-y-2">
              <button className="w-full h-[52px] rounded-[12px] border border-[var(--color-border)] px-4 text-left inline-flex items-center gap-2">
                <Search size={18} /> {t("contacts.searchMonoId")}
              </button>
              <button className="w-full h-[52px] rounded-[12px] border border-[var(--color-border)] px-4 text-left inline-flex items-center gap-2">
                <QrCode size={18} /> QR
              </button>
              <button className="w-full h-[52px] rounded-[12px] border border-[var(--color-border)] px-4 text-left inline-flex items-center gap-2">
                <Link2 size={18} /> Share Invite Link
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowAddSheet(false)}
              className="mt-3 w-full h-[44px] rounded-[10px] border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            >
              {t("common.close")}
            </button>
          </div>
      </BottomSheet>

      <BottomSheet open={!!activeFriend} onClose={() => setActiveFriend(null)}>
          <div className="p-5 pb-[calc(20px+env(safe-area-inset-bottom))]">
            <div className="w-20 h-20 rounded-full bg-[var(--color-bg-secondary)] mx-auto flex items-center justify-center text-[26px] font-semibold">
              {(activeFriend?.nickname || "M").charAt(0).toUpperCase()}
            </div>
            <div className="mt-3 text-center">
              <div className="text-[17px] font-semibold">{activeFriend?.nickname || t("contacts.unknownUser")}</div>
              <div className="text-[14px] text-[var(--color-text-secondary)] mt-1">@{activeFriend?.monoId || ""}</div>
              <div className="text-[13px] text-[var(--color-text-secondary)] mt-1">Lang: {renderLang(activeFriend?.nativeLanguage)}</div>
              <div className="text-[13px] text-[var(--color-text-secondary)] mt-1">{activeFriend?.statusMessage || "No status message"}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                const id = activeFriend?.id;
                setActiveFriend(null);
                if (id) startDm(id);
              }}
              className="mono-btn mt-5 w-full h-[44px] bg-[var(--color-primary)] text-white border border-[var(--color-primary)]"
            >
              {t("nav.chat")}
            </button>
            <button
              type="button"
              onClick={async () => {
                const id = activeFriend?.id;
                setActiveFriend(null);
                if (id) await removeFriend(id);
              }}
              className="mt-3 w-full text-[14px] text-[#DC2626]"
            >
              {t("common.delete")}
            </button>
          </div>
      </BottomSheet>
    </div>
  );
}

