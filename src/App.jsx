import React, { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import router from "./router";
import InAppBlocker from "./components/InAppBlocker"; // ✅ 추가
import socket from "./socket";
import { getMyIdentity } from "./db";
import { subscribeToPush } from "./push";

const App = () => {
  useEffect(() => {
    let disposed = false;
    let registerHandler = null;
    // App first load: restore identity -> register user -> subscribe push.
    getMyIdentity().then((me) => {
      if (disposed || !me?.userId) return;
      registerHandler = () => {
        socket.emit("register-user", {
          userId: me.userId,
          canonicalName: me.canonicalName,
          lang: me.lang,
        });
      };
      if (socket.connected) registerHandler();
      socket.on("connect", registerHandler);
      subscribeToPush(me.userId).catch(() => {});
    }).catch(() => {});

    return () => {
      disposed = true;
      if (registerHandler) socket.off("connect", registerHandler);
    };
  }, []);

  return (
    <>
      <InAppBlocker />   {/* ✅ 인앱 브라우저 차단 */}
      <RouterProvider router={router} />
    </>
  );
};

export default App;
