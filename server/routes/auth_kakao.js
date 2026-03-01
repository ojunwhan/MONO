const axios = require('axios');
const jwt = require('jsonwebtoken');
const { upsertUserFromOAuth } = require('../db/users');

module.exports = function attachKakaoAuth(app) {
  function getCallbackUrl() {
    const explicit = String(process.env.KAKAO_CALLBACK_URL || '').trim();
    if (explicit) return explicit;
    return 'http://localhost:3174/api/auth/kakao/callback';
  }

  function getKakaoClientId() {
    return String(process.env.KAKAO_CLIENT_ID || '').trim();
  }

  // JWT_SECRET 환경 변수 존재 여부 확인
  if (!process.env.JWT_SECRET) {
    console.error('SERVER_MISCONFIG: JWT_SECRET environment variable is not set for Kakao authentication.');
    // 이 미들웨어는 Express 앱에 등록되므로, 직접 응답을 보냅니다.
    app.use('/auth/kakao', (req, res) => {
      res.status(500).send('SERVER_MISCONFIG:JWT_SECRET');
    });
    app.use('/auth/kakao/callback', (req, res) => {
      res.status(500).send('SERVER_MISCONFIG:JWT_SECRET');
    });
    return; // JWT_SECRET이 없으면 더 이상 라우트 설정을 진행하지 않습니다.
  }

  // 1) 카카오로 리다이렉트
  app.get('/auth/kakao', (req, res) => {
    const next = req.query.next || '/';
    const callbackUrl = getCallbackUrl();
    const clientId = getKakaoClientId();
    if (!clientId) {
      return res.status(503).send('KAKAO_CLIENT_ID_MISSING');
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      state: Buffer.from(JSON.stringify({ next })).toString('base64url'),
    });
    res.redirect(`https://kauth.kakao.com/oauth/authorize?${params.toString()}`);
  });
  app.get('/api/auth/kakao', (req, res) => {
    const next = encodeURIComponent(req.query.next || '/');
    return res.redirect(`/auth/kakao?next=${next}`);
  });

  // 2) 콜백 → 토큰 교환 → 사용자 조회 → JWT 발급 → next로 이동
  app.get('/api/auth/kakao/callback', async (req, res) => {
    try {
      const { code, state, error: oauthError, error_description: oauthErrorDescription } = req.query;
      const callbackUrl = getCallbackUrl();
      const clientId = getKakaoClientId();
      console.log('[kakao][callback] start', {
        hasCode: Boolean(code),
        hasOAuthError: Boolean(oauthError),
        callbackUrl,
        hasClientId: Boolean(clientId),
      });
      if (oauthError) {
        console.error('[kakao][callback] oauth error from provider', {
          oauthError,
          oauthErrorDescription,
          callbackUrl,
        });
        return res.redirect('/login?oauth_error=kakao_provider_error');
      }
      if (!code) {
        console.error('[kakao][callback] missing authorization code', {
          callbackUrl,
        });
        return res.redirect('/login?oauth_error=kakao_missing_code');
      }
      if (!clientId) {
        return res.status(503).send('KAKAO_CLIENT_ID_MISSING');
      }
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: callbackUrl,
        code,
      });
      const clientSecret = String(process.env.KAKAO_CLIENT_SECRET || '').trim();
      // client_secret is optional for Kakao OAuth.
      if (clientSecret) {
        tokenParams.set('client_secret', clientSecret);
      }
      console.log('[kakao][callback] token exchange request', {
        hasClientSecret: Boolean(clientSecret),
        callbackUrl,
      });

      // 액세스 토큰
      let tokenRes;
      try {
        tokenRes = await axios.post('https://kauth.kakao.com/oauth/token', tokenParams, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch (tokenErr) {
        console.error('[kakao][callback] token exchange failed', {
          status: tokenErr?.response?.status,
          data: tokenErr?.response?.data,
          hasCode: Boolean(code),
          hasClientSecret: Boolean(clientSecret),
          callbackUrl,
        });
        throw tokenErr;
      }

      const accessToken = tokenRes.data.access_token;
      console.log('[kakao][callback] token exchange success', {
        hasAccessToken: Boolean(accessToken),
      });
      if (!accessToken) return res.status(400).send('KAKAO_NO_TOKEN');

      // 사용자 정보
      const meRes = await axios.get('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const kuser = meRes.data;
      const email = kuser?.kakao_account?.email || '';
      const profile = {
        provider: 'kakao',
        providerUserId: String(kuser.id),
        displayName: kuser.properties?.nickname || 'Kakao User',
        photoURL: kuser.properties?.profile_image || '',
        email,
      };

      let appUser = null;
      try {
        appUser = await upsertUserFromOAuth({
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          email: profile.email,
          nickname: profile.displayName,
          avatarUrl: profile.photoURL,
          nativeLanguage: 'ko',
        });
      } catch (dbErr) {
        console.error('kakao_user_sync_error', dbErr?.message || dbErr);
        return res.status(500).send('KAKAO_USER_SYNC_FAILED');
      }

      // JWT (30일)
      const appJwt = jwt.sign(
        { sub: appUser?.id || `kakao:${profile.providerUserId}`, name: profile.displayName, pic: profile.photoURL, p: profile.provider },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.cookie('token', appJwt, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      let next = '/';
      if (state) {
        try { next = JSON.parse(Buffer.from(state, 'base64url').toString()).next || next; } catch {}
      }
      return res.redirect(next);
    } catch (e) {
      console.error('kakao_callback_error', e?.response?.data || e);
      return res.status(500).send('KAKAO_CALLBACK_ERROR');
    }
  });
  app.get('/auth/kakao/callback', (req, res) => {
    const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(`/api/auth/kakao/callback${q}`);
  });
};
