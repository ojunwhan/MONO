const axios = require('axios');
const jwt = require('jsonwebtoken');

module.exports = function attachKakaoAuth(app) {
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
    const params = new URLSearchParams({
      client_id: process.env.KAKAO_CLIENT_ID,
      redirect_uri: process.env.KAKAO_CALLBACK_URL,
      response_type: 'code',
      state: Buffer.from(JSON.stringify({ next })).toString('base64url'),
    });
    res.redirect(`https://kauth.kakao.com/oauth/authorize?${params.toString()}`);
  });

  // 2) 콜백 → 토큰 교환 → 사용자 조회 → JWT 발급 → next로 이동
  app.get('/auth/kakao/callback', async (req, res) => {
    try {
      const { code, state } = req.query;

      // 액세스 토큰
      const tokenRes = await axios.post('https://kauth.kakao.com/oauth/token', new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KAKAO_CLIENT_ID,
        client_secret: process.env.KAKAO_CLIENT_SECRET, // 사용 설정된 경우 필수
        redirect_uri: process.env.KAKAO_CALLBACK_URL,
        code,
      }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

      const accessToken = tokenRes.data.access_token;
      if (!accessToken) return res.status(400).send('KAKAO_NO_TOKEN');

      // 사용자 정보
      const meRes = await axios.get('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const kuser = meRes.data;
      const sub = `kakao:${kuser.id}`;
      const profile = {
        id: sub,
        displayName: kuser.properties?.nickname || 'Kakao User',
        photoURL: kuser.properties?.profile_image || '',
        provider: 'kakao',
      };

      // JWT (30일)
      const appJwt = require('jsonwebtoken').sign(
        { sub: profile.id, name: profile.displayName, pic: profile.photoURL, p: profile.provider },
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
};
