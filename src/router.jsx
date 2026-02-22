import { createBrowserRouter } from "react-router-dom";
import Home from "./pages/Home";
import Setup from "./pages/Setup";
import RoomList from "./pages/RoomList";
import ChatScreen from "./components/ChatScreen";

const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,    // Legacy QR-based join flow
  },
  {
    path: "/setup",
    element: <Setup />,   // First-time name + language setup
  },
  {
    path: "/rooms",
    element: <RoomList />, // Recent conversations list
  },
  {
    path: "/room/:roomId",
    element: <ChatScreen />,
  },
]);

export default router;
