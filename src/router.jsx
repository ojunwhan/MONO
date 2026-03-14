import { createBrowserRouter, redirect } from "react-router-dom";
import Home from "./pages/Home";
import Setup from "./pages/Setup";
import RoomList from "./pages/RoomList";
import ChatScreen from "./components/ChatScreen";
import AppShell from "./layouts/AppShell";
import Contacts from "./pages/Contacts";
import SettingsPage from "./pages/Settings";
import LoginPage from "./pages/Login";
import CsChatPage from "./pages/CsChat";
import GuestJoinPage from "./pages/GuestJoin";
import KioskPage from "./pages/KioskPage";
import TermsPage from "./pages/Terms";
import PrivacyPage from "./pages/Privacy";
import HospitalApp from "./pages/HospitalApp";
import HospitalRecords from "./pages/HospitalRecords";
import HospitalDashboard from "./pages/HospitalDashboard";
import HospitalLogin from "./pages/HospitalLogin";
import HospitalRegister from "./pages/HospitalRegister";
import HospitalKiosk from "./pages/HospitalKiosk";
import HospitalPatientJoin from "./pages/HospitalPatientJoin";
import HospitalStaffQr from "./pages/HospitalStaffQr";
import HospitalAesthetic from "./pages/HospitalAesthetic";
import OrgSetup from "./pages/OrgSetup";
import FixedRoom from "./pages/FixedRoom";
import FixedRoomVAD from "./pages/FixedRoomVAD";
import AdminLogin from "./pages/Admin/AdminLogin";
import AdminLayout from "./pages/Admin/AdminLayout";
import AdminOrgs from "./pages/Admin/AdminOrgs";
import AdminOrgDetail from "./pages/Admin/AdminOrgDetail";
import VisualPipelineBuilder from "./pages/Admin/VisualPipelineBuilder";
import OrgKiosk from "./pages/Org/OrgKiosk";
import OrgStaff from "./pages/Org/OrgStaff";
import OrgJoin from "./pages/Org/OrgJoin";
import { fetchAuthMe, syncAuthUserToLocalIdentity } from "./auth/session";

async function rootRedirectLoader({ request }) {
  const url = new URL(request.url);
  const pathname = url.pathname || "/";
  const roomId = url.searchParams.get("roomId");
  if (roomId) {
    const siteContext = url.searchParams.get("siteContext") || "general";
    const roomType = url.searchParams.get("roomType") || "oneToOne";
    return redirect(`/join/${encodeURIComponent(roomId)}?siteContext=${encodeURIComponent(siteContext)}&roomType=${encodeURIComponent(roomType)}`);
  }

  // Only run auth redirect for exact root "/". Other paths (e.g. /hospital-login) are public — no redirect.
  if (pathname !== "/") return null;

  const me = await fetchAuthMe();
  if (me.authenticated) {
    await syncAuthUserToLocalIdentity();
    return redirect("/interpret");
  }
  return redirect("/login");
}

async function hospitalDashboardLoader() {
  const res = await fetch("/api/hospital/auth/me", { credentials: "include" });
  if (!res.ok) {
    return redirect("/hospital-login?redirect=" + encodeURIComponent("/hospital-dashboard"));
  }
  return null;
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
    path: "/hospital/join/:orgCode",
    loader: () => null,
    element: <HospitalPatientJoin />,
  },
  {
    path: "/org-setup",
    element: <OrgSetup />,
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
        path: "settings",
        element: <SettingsPage />,
      },
    ],
  },
  {
    path: "/join/:roomId",
    element: <GuestJoinPage />,
  },
  {
    path: "/room/:roomId",
    element: <ChatScreen />,
  },
  {
    path: "/cs-chat",
    element: <CsChatPage />,
  },
  {
    path: "/hospital",
    loader: () => null,
    element: <HospitalApp />,
  },
  {
    path: "/hospital/records",
    element: <HospitalRecords />,
  },
  {
    path: "/hospital/aesthetic",
    element: <HospitalAesthetic />,
  },
  {
    path: "/hospital/kiosk/:department",
    element: <HospitalKiosk />,
  },
  {
    path: "/hospital/staff-qr/:orgCode",
    element: <HospitalStaffQr />,
  },
  {
    path: "/hospital-login",
    element: <HospitalLogin />,
  },
  {
    path: "/hospital-register",
    element: <HospitalRegister />,
  },
  {
    path: "/hospital-dashboard",
    loader: hospitalDashboardLoader,
    element: <HospitalDashboard />,
  },
  {
    path: "/fixed/:location",
    element: <FixedRoom />,
  },
  {
    path: "/fixed-room/:roomId",
    element: <FixedRoomVAD />,
  },
  {
    path: "/admin",
    children: [
      {
        index: true,
        element: <AdminLogin />,
      },
      {
        element: <AdminLayout />,
        children: [
          {
            path: "orgs",
            element: <AdminOrgs />,
          },
          {
            path: "orgs/:orgId",
            element: <AdminOrgDetail />,
          },
          {
            path: "orgs/:orgId/dept/:deptId/pipeline",
            element: <VisualPipelineBuilder />,
          },
          {
            path: "pipeline",
            element: <VisualPipelineBuilder />,
          },
        ],
      },
    ],
  },
  {
    path: "/org/:orgCode/:deptCode/kiosk",
    element: <OrgKiosk />,
  },
  {
    path: "/org/:orgCode/:deptCode/staff",
    element: <OrgStaff />,
  },
  {
    path: "/org/:orgCode/:deptCode/join",
    element: <OrgJoin />,
  },
  {
    path: "/kiosk",
    element: <KioskPage />,
  },
  {
    path: "/terms",
    element: <TermsPage />,
  },
  {
    path: "/privacy",
    element: <PrivacyPage />,
  },
]);

export default router;
