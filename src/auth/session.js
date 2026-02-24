import { setMyIdentity } from "../db";

export async function fetchAuthMe() {
  try {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { authenticated: false, user: null };
    const data = await res.json();
    return {
      authenticated: !!data?.authenticated,
      user: data?.user || null,
    };
  } catch {
    return { authenticated: false, user: null };
  }
}

export async function syncAuthUserToLocalIdentity() {
  const me = await fetchAuthMe();
  if (!me.authenticated || !me.user?.id) return me;
  await setMyIdentity({
    userId: me.user.id,
    canonicalName: me.user.nickname || "MONO User",
    lang: me.user.nativeLanguage || "en",
  });
  return me;
}

