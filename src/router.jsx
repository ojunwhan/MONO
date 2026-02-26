import { createBrowserRouter, redirect } from "react-router-dom";
import Home from "./pages/Home";
import Setup from "./pages/Setup";
import RoomList from "./pages/RoomList";
import ChatScreen from "./components/ChatScreen";
import AppShell from "./layouts/AppShell";
import Contacts from "./pages/Contacts";
import GlobalPage from "./pages/Global";
import SettingsPage from "./pages/Settings";
import LoginPage from "./pages/Login";
import CsChatPage from "./pages/CsChat";
import { fetchAuthMe, syncAuthUserToLocalIdentity } from "./auth/session";

async function rootRedirectLoader({ request }) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");
  if (roomId) {
    const search = url.searchParams.toString();
    return redirect(`/interpret?${search}`);
  }

  const me = await fetchAuthMe();
  if (me.authenticated) {
    await syncAuthUserToLocalIdentity();
    return redirect("/home");
  }
  return redirect("/login");
}

const router = createBrowserRouter([
  {
    path: "/",
    loader: rootRedirectLoader,
  },
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    path: "/setup",
    element: <Setup />,   // First-time name + language setup
  },
  {
    path: "/rooms",
    loader: () => redirect("/home"), // Backward compatibility route
  },
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        path: "home",
        element: <RoomList />,
      },
      {
        path: "contacts",
        element: <Contacts />,
      },
      {
        path: "interpret",
        element: <Home />,
      },
      {
        path: "global",
        element: <GlobalPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
    ],
  },
  {
    path: "/room/:roomId",
    element: <ChatScreen />,
  },
  {
    path: "/cs-chat",
    element: <CsChatPage />,
  },
]);

export default router;
