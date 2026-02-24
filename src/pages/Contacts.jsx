import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import socket from "../socket";
import { getMyIdentity } from "../db";
import { getLanguageProfileByCode } from "../constants/languageProfiles";
import { UserRound, UserPlus, Phone, Send } from "lucide-react";

export default function Contacts() {
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
      setMessage("연락처를 불러오지 못했습니다.");
    }
  }, [authFetch]);

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
      setMessage("MONO ID 2글자 이상 입력해주세요.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/contacts/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        setMessage("검색에 실패했습니다.");
        return;
      }
      setSearchResults(Array.isArray(data?.users) ? data.users : []);
      if (!data?.users?.length) setMessage("검색 결과가 없습니다.");
    } catch {
      setMessage("검색 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }, [authFetch, query]);

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
          setMessage("친구 요청 실패");
          return;
        }
        setMessage(data.relation === "accepted" ? "친구가 추가되었습니다." : "친구 요청을 보냈습니다.");
        await loadLists();
        await onSearch();
      } catch {
        setMessage("친구 요청 중 오류가 발생했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [authFetch, loadLists, onSearch]
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
          setMessage("요청 처리 실패");
          return;
        }
        await loadLists();
      } catch {
        setMessage("요청 처리 중 오류가 발생했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [authFetch, loadLists]
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
          setMessage("친구 삭제 실패");
          return;
        }
        await loadLists();
      } catch {
        setMessage("친구 삭제 중 오류가 발생했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [authFetch, loadLists]
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
          setMessage("전화번호를 확인해주세요.");
          return;
        }
        const res = await authFetch("/api/contacts/lookup-phone", {
          method: "POST",
          body: JSON.stringify({ phones: cleaned }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessage("연락처 검색 실패");
          return;
        }
        setPhoneMembers(Array.isArray(data?.members) ? data.members : []);
        setNonMembers(Array.isArray(data?.nonMembers) ? data.nonMembers : []);
        if (!data?.members?.length && !data?.nonMembers?.length) {
          setMessage("검색 결과가 없습니다.");
        }
      } catch {
        setMessage("연락처 검색 중 오류가 발생했습니다.");
      } finally {
        setBusy(false);
      }
    },
    [authFetch]
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
      setMessage("연락처 선택이 취소되었거나 실패했습니다.");
    }
  }, [lookupPhones, supportsContactPicker]);

  const lookupManualPhone = useCallback(async () => {
    await lookupPhones([phoneInput]);
  }, [lookupPhones, phoneInput]);

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-5 space-y-4">
      <div className="mono-card p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-[18px] font-semibold">연락처</h1>
          <span className="mono-chip bg-[#eef2f7] text-[#4b5563]">
            요청 {pendingCount}
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="MONO ID 검색"
            className="mono-input flex-1 h-[44px] px-3"
          />
          <button
            type="button"
            onClick={onSearch}
            disabled={busy}
            className="mono-btn h-[44px] px-4 border border-[#111] bg-[#111] text-white"
          >
            검색
          </button>
        </div>
        {message ? <p className="mt-2 text-[12px] text-[#666]">{message}</p> : null}
      </div>

      <div className="mono-card p-4">
        <h2 className="text-[14px] font-semibold flex items-center gap-2">
          <UserPlus size={15} /> 친구 요청
        </h2>
        <div className="mt-2 space-y-2">
          {requests.length === 0 ? (
            <div className="text-[12px] text-[#888]">대기 중인 요청이 없습니다.</div>
          ) : (
            requests.map((u) => (
              <div key={`req-${u.id}`} className="border border-[#E5E7EB] rounded-[10px] p-3">
                <div className="text-[14px] font-medium">{u.nickname || "Unknown"}</div>
                <div className="text-[12px] text-[#666]">@{u.monoId} · {renderLang(u.nativeLanguage)}</div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => respondRequest(u.id, "accept")}
                    className="mono-btn h-[36px] px-3 border border-[#111] bg-[#111] text-white"
                  >
                    수락
                  </button>
                  <button
                    type="button"
                    onClick={() => respondRequest(u.id, "reject")}
                    className="mono-btn h-[36px] px-3 border border-[#D1D5DB] bg-white text-[#111]"
                  >
                    거절
                  </button>
                  <button
                    type="button"
                    onClick={() => respondRequest(u.id, "block")}
                    className="mono-btn h-[36px] px-3 border border-[#D1D5DB] bg-white text-[#111]"
                  >
                    차단
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mono-card p-4">
        <h2 className="text-[14px] font-semibold">검색 결과</h2>
        <div className="mt-2 space-y-2">
          {searchResults.length === 0 ? (
            <div className="text-[12px] text-[#888]">검색 결과가 없습니다.</div>
          ) : (
            searchResults.map((u) => (
              <div key={`search-${u.id}`} className="border border-[#E5E7EB] rounded-[10px] p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium truncate">{u.nickname || "Unknown"}</div>
                  <div className="text-[12px] text-[#666] truncate">@{u.monoId} · {renderLang(u.nativeLanguage)}</div>
                </div>
                <div>
                  {u.relation === "accepted" ? (
                    <button
                      type="button"
                      onClick={() => startDm(u.id)}
                      className="mono-btn h-[36px] px-3 border border-[#111] bg-[#111] text-white"
                    >
                      대화
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendRequest(u.monoId)}
                      className="mono-btn h-[36px] px-3 border border-[#111] bg-[#111] text-white"
                    >
                      {u.relation === "pending_sent" ? "재요청" : "추가"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mono-card p-4">
        <h2 className="text-[14px] font-semibold flex items-center gap-2">
          <UserRound size={15} /> MONO 친구
        </h2>
        <div className="mt-2 space-y-2">
          {friends.length === 0 ? (
            <div className="text-[12px] text-[#888]">친구가 없습니다.</div>
          ) : (
            friends.map((u) => (
              <div key={`friend-${u.id}`} className="border border-[#E5E7EB] rounded-[10px] p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium truncate">{u.nickname || "Unknown"}</div>
                  <div className="text-[12px] text-[#666] truncate">@{u.monoId} · {renderLang(u.nativeLanguage)}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startDm(u.id)}
                    className="mono-btn h-[36px] px-3 border border-[#111] bg-[#111] text-white"
                  >
                    대화
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFriend(u.id)}
                    className="mono-btn h-[36px] px-3 border border-[#D1D5DB] bg-white text-[#111]"
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mono-card p-4">
        <h2 className="text-[14px] font-semibold flex items-center gap-2">
          <Phone size={15} /> 연락처에서 초대
        </h2>
        <p className="mt-1 text-[12px] text-[#666]">
          휴대폰 연락처로 MONO 가입자를 찾고, 미가입자에게 초대 링크를 보낼 수 있습니다.
        </p>

        {supportsContactPicker ? (
          <button
            type="button"
            onClick={pickContacts}
            disabled={busy}
            className="mono-btn mt-3 h-[44px] px-4 border border-[#111] bg-[#111] text-white"
          >
            연락처에서 친구 찾기
          </button>
        ) : (
          <div className="mt-3 flex gap-2">
            <input
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="전화번호 입력 (예: 01012345678)"
              className="mono-input flex-1 h-[44px] px-3"
            />
            <button
              type="button"
              onClick={lookupManualPhone}
              disabled={busy}
              className="mono-btn h-[44px] px-4 border border-[#111] bg-[#111] text-white"
            >
              검색
            </button>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {phoneMembers.map((u) => (
            <div key={`phone-member-${u.id}`} className="border border-[#E5E7EB] rounded-[10px] p-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[14px] font-medium truncate">{u.nickname || "Unknown"}</div>
                <div className="text-[12px] text-[#666] truncate">@{u.monoId} · {u.phoneNumber}</div>
              </div>
              <button
                type="button"
                onClick={() => sendRequest(u.monoId)}
                className="mono-btn h-[36px] px-3 border border-[#111] bg-[#111] text-white"
              >
                친구추가
              </button>
            </div>
          ))}

          {nonMembers.map((phone) => (
            <div key={`non-member-${phone}`} className="border border-[#E5E7EB] rounded-[10px] p-3 flex items-center justify-between gap-2">
              <div className="text-[13px] text-[#666] truncate">{phone}</div>
              <button
                type="button"
                onClick={() => {
                  const inviteUrl = `${window.location.origin}/interpret`;
                  const smsUrl = `sms:${phone}?body=${encodeURIComponent(`MONO 초대 링크: ${inviteUrl}`)}`;
                  window.location.href = smsUrl;
                }}
                className="mono-btn h-[36px] px-3 border border-[#D1D5DB] bg-white text-[#111] inline-flex items-center gap-1"
              >
                <Send size={14} /> 초대 링크 보내기
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

