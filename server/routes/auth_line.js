const axios = require("axios");
const jwt = require("jsonwebtoken");
const { upsertUserFromOAuth } = require("../db/users");

module.exports = function attachLineAuth(app) {
  if (!process.env.JWT_SECRET) {
    app.use("/auth/line", (req, res) => res.status(500).send("SERVER_MISCONFIG:JWT_SECRET"));
    app.use("/auth/line/callback", (req, res) => res.status(500).send("SERVER_MISCONFIG:JWT_SECRET"));
    return;
  }

  const clientId = process.env.LINE_CLIENT_ID || "";
  const clientSecret = process.env.LINE_CLIENT_SECRET || "";
  const callbackUrl = process.env.LINE_CALLBACK_URL || "https://lingora.chat/auth/line/callback";

  app.get("/auth/line", (req, res) => {
    if (!clientId || !clientSecret) {
      return res.status(503).send("LINE_NOT_CONFIGURED");
    }
    const next = req.query.next || "/";
    const state = Buffer.from(JSON.stringify({ next })).toString("base64url");
    const nonce = Math.random().toString(36).slice(2);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callbackUrl,
      state,
      scope: "profile openid email",
      nonce,
    });
    return res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`);
  });
  app.get("/api/auth/line", (req, res) => {
    const next = encodeURIComponent(req.query.next || "/");
    return res.redirect(`/auth/line?next=${next}`);
  });

  app.get("/auth/line/callback", async (req, res) => {
    try {
      if (!clientId || !clientSecret) {
        return res.status(503).send("LINE_NOT_CONFIGURED");
      }
      const { code, state } = req.query;
      const tokenRes = await axios.post(
        "https://api.line.me/oauth2/v2.1/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callbackUrl,
          client_id: clientId,
          client_secret: clientSecret,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      const accessToken = tokenRes?.data?.access_token;
      const idToken = tokenRes?.data?.id_token;
      if (!accessToken && !idToken) return res.status(400).send("LINE_NO_TOKEN");

      const profileRes = await axios.get("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profile = profileRes?.data || {};

      let email = "";
      if (idToken) {
        try {
          const payloadRaw = String(idToken).split(".")[1] || "";
          const payloadJson = Buffer.from(payloadRaw, "base64url").toString();
          const payload = JSON.parse(payloadJson);
          email = payload?.email || "";
        } catch {}
      }

      const appUser = await upsertUserFromOAuth({
        provider: "line",
        providerUserId: String(profile.userId || ""),
        email,
        nickname: profile.displayName || "LINE User",
        avatarUrl: profile.pictureUrl || "",
        nativeLanguage: "ja",
      });

      const appJwt = jwt.sign(
        {
          sub: appUser?.id || `line:${profile.userId}`,
          name: profile.displayName || "LINE User",
          pic: profile.pictureUrl || "",
          p: "line",
        },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      const secureCookie =
        req.secure || String(req.headers["x-forwarded-proto"] || "").includes("https");
      res.cookie("token", appJwt, {
        httpOnly: true,
        secure: secureCookie,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      let next = "/";
      if (state) {
        try {
          next = JSON.parse(Buffer.from(state, "base64url").toString()).next || next;
        } catch {}
      }
      return res.redirect(next);
    } catch (e) {
      console.error("line_callback_error", e?.response?.data || e?.message || e);
      return res.status(500).send("LINE_CALLBACK_ERROR");
    }
  });
  app.get("/api/auth/line/callback", (req, res) => {
    const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(`/auth/line/callback${q}`);
  });
};

