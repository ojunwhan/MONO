const DEFAULT_KAKAO_JS_KEY = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY || "";

function isKakaoSdkReady() {
  return typeof window !== "undefined" && !!window.Kakao;
}

export function initKakaoSdk() {
  if (!isKakaoSdkReady()) return false;
  if (!DEFAULT_KAKAO_JS_KEY) return false;
  try {
    if (!window.Kakao.isInitialized()) {
      window.Kakao.init(DEFAULT_KAKAO_JS_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function startKakaoLogin(next = "/home") {
  const encodedNext = encodeURIComponent(next || "/home");
  const fallbackUrl = `/auth/kakao?next=${encodedNext}`;
  const initialized = initKakaoSdk();
  if (!initialized) {
    window.location.href = fallbackUrl;
    return;
  }

  try {
    const state = window.btoa(JSON.stringify({ next: next || "/home" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    // Kakao Developers 설정 체크:
    // 1) 플랫폼 > Web: https://lingora.chat 등록
    // 2) 카카오 로그인 > Redirect URI: https://lingora.chat/api/auth/kakao/callback 등록
    // 3) 카카오 로그인 > 동의항목: 닉네임/프로필/이메일 설정
    window.Kakao.Auth.authorize({
      redirectUri: "https://lingora.chat/api/auth/kakao/callback",
      throughTalk: true,
      state,
    });
  } catch {
    window.location.href = fallbackUrl;
  }
}

