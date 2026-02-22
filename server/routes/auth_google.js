const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

module.exports = function attachGoogleAuth(app) {
  // JWT_SECRET 환경 변수 존재 여부 확인
  if (!process.env.JWT_SECRET) {
    console.error('SERVER_MISCONFIG: JWT_SECRET environment variable is not set for Google authentication.');
    // 이 미들웨어는 Express 앱에 등록되므로, 직접 응답을 보냅니다.
    app.use('/auth/google', (req, res) => {
      res.status(500).send('SERVER_MISCONFIG:JWT_SECRET');
    });
    app.use('/auth/google/callback', (req, res) => {
      res.status(500).send('SERVER_MISCONFIG:JWT_SECRET');
    });
    return; // JWT_SECRET이 없으면 더 이상 라우트 설정을 진행하지 않습니다.
  }

  const client = new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_CALLBACK_URL,
  });

  // 1) 구글로 리다이렉트
  app.get('/auth/google', (req, res) => {
    const next = req.query.next || '/';
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: ['openid', 'email', 'profile'],
      prompt: 'consent',
      state: Buffer.from(JSON.stringify({ next })).toString('base64url'),
    });
    res.redirect(url);
  });

  // 2) 콜백 → JWT 발급 → next로 이동
  app.get('/auth/google/callback', async (req, res) => {
    try {
      const { code, state } = req.query;
      const { tokens } = await client.getToken(code);
      const idToken = tokens.id_token;
      if (!idToken) return res.status(400).send('GOOGLE_NO_IDTOKEN');

      // ID 토큰에서 사용자 정보 추출
      const ticket = await client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const sub = `google:${payload.sub}`;
      const profile = {
        id: sub,
        displayName: payload.name || 'Google User',
        photoURL: payload.picture || '',
        email: payload.email || '',
        provider: 'google',
      };

      // JWT 발급 (30일)
      const appJwt = jwt.sign(
        { sub: profile.id, name: profile.displayName, pic: profile.photoURL, p: profile.provider },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );

      // httpOnly 쿠키 + 로컬에서도 동작하도록 sameSite Lax
      res.cookie('token', appJwt, {
        httpOnly: true,
        secure: true,          // 프로덕션(https) 기준
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      let next = '/';
      if (state) {
        try { next = JSON.parse(Buffer.from(state, 'base64url').toString()).next || next; } catch {}
      }
      return res.redirect(next);
    } catch (e) {
      console.error('google_callback_error', e);
      return res.status(500).send('GOOGLE_CALLBACK_ERROR');
    }
  });
};
