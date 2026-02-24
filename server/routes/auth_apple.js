const axios = require("axios");
const jwt = require("jsonwebtoken");
const { upsertUserFromOAuth } = require("../db/users");

module.exports = function attachAppleAuth(app) {
  if (!process.env.JWT_SECRET) {
    app.use("/auth/apple", (req, res) => res.status(500).send("SERVER_MISCONFIG:JWT_SECRET"));
    app.use("/auth/apple/callback", (req, res) => res.status(500).send("SERVER_MISCONFIG:JWT_SECRET"));
    return;
  }

  const clientId = process.env.APPLE_CLIENT_ID || "";
  const teamId = process.env.APPLE_TEAM_ID || "";
  const keyId = process.env.APPLE_KEY_ID || "";
  const privateKey = String(process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const callbackUrl = process.env.APPLE_CALLBACK_URL || "https://lingora.chat/auth/apple/callback";
  const isConfigured = !!clientId && !!teamId && !!keyId && !!privateKey;

  function createAppleClientSecret() {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: teamId,
        iat: now,
        exp: now + 60 * 60 * 24 * 180,
        aud: "https://appleid.apple.com",
        sub: clientId,
      },
      privateKey,
      { algorithm: "ES256", keyid: keyId }
    );
  }

  app.get("/auth/apple", (req, res) => {
    if (!isConfigured) return res.status(503).send("APPLE_NOT_CONFIGURED");
    const next = req.query.next || "/";
    const state = Buffer.from(JSON.stringify({ next })).toString("base64url");
    const nonce = Math.random().toString(36).slice(2);
    const params = new URLSearchParams({
      response_type: "code id_token",
      response_mode: "form_post",
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope: "name email",
      state,
      nonce,
    });
    return res.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
  });
  app.get("/api/auth/apple", (req, res) => {
    const next = encodeURIComponent(req.query.next || "/");
    return res.redirect(`/auth/apple?next=${next}`);
  });

  async function appleCallbackHandler(req, res) {
    try {
      if (!isConfigured) return res.status(503).send("APPLE_NOT_CONFIGURED");

      const code = String(req.body?.code || req.query?.code || "").trim();
      let idToken = String(req.body?.id_token || req.query?.id_token || "").trim();
      const state = String(req.body?.state || req.query?.state || "");

      if (!idToken && code) {
        const clientSecret = createAppleClientSecret();
        const tokenRes = await axios.post(
          "https://appleid.apple.com/auth/token",
          new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: callbackUrl,
            client_id: clientId,
            client_secret: clientSecret,
          }),
          { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );
        idToken = String(tokenRes?.data?.id_token || "");
      }

      if (!idToken) return res.status(400).send("APPLE_NO_ID_TOKEN");
      let claims = {};
      try {
        const payloadRaw = idToken.split(".")[1] || "";
        claims = JSON.parse(Buffer.from(payloadRaw, "base64url").toString());
      } catch {
        return res.status(400).send("APPLE_INVALID_ID_TOKEN");
      }

      const appleSub = String(claims?.sub || "").trim();
      if (!appleSub) return res.status(400).send("APPLE_INVALID_SUB");
      const email = String(
        req.body?.email ||
          claims?.email ||
          ""
      )
        .trim()
        .toLowerCase();
      const userJson = String(req.body?.user || "").trim();
      let fullName = "";
      if (userJson) {
        try {
          const u = JSON.parse(userJson);
          const first = String(u?.name?.firstName || "").trim();
          const last = String(u?.name?.lastName || "").trim();
          fullName = `${first} ${last}`.trim();
        } catch {}
      }
      const nickname = fullName || "Apple User";

      const appUser = await upsertUserFromOAuth({
        provider: "apple",
        providerUserId: appleSub,
        email,
        nickname,
        avatarUrl: "",
        nativeLanguage: "en",
      });

      const token = jwt.sign(
        { sub: appUser?.id || `apple:${appleSub}`, name: nickname, p: "apple" },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );
      const secureCookie =
        req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
      res.cookie("token", token, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      let next = "/home";
      if (state) {
        try {
          next = JSON.parse(Buffer.from(state, "base64url").toString()).next || next;
        } catch {}
      }
      return res.redirect(next);
    } catch (e) {
      console.error("apple_callback_error", e?.response?.data || e?.message || e);
      return res.status(500).send("APPLE_CALLBACK_ERROR");
    }
  }

  app.post("/auth/apple/callback", appleCallbackHandler);
  app.get("/auth/apple/callback", appleCallbackHandler);
  app.post("/api/auth/apple/callback", appleCallbackHandler);
  app.get("/api/auth/apple/callback", appleCallbackHandler);
};

