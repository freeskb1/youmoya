import { useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import JoinPage from "./pages/JoinPage";
import RoomPage from "./pages/RoomPage";
import HubEntry from "./pages/HubEntry";
import { readHubParams } from "./lib/hub";

function AppRoutes() {
  const navigate = useNavigate();
  // 말랑월드에서 넘어온 경우(쿼리 있음) → 자동 입장 후 대기실로. 저장된 재접속 정보보다 우선.
  const [hubParams, setHubParams] = useState(() => readHubParams());

  const handleHubDone = useCallback(
    (code) => {
      navigate(`/room/${code}`, { replace: true });
      setHubParams(null);
    },
    [navigate]
  );

  if (hubParams) {
    return <HubEntry params={hubParams} onDone={handleHubDone} />;
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/room/:code" element={<RoomPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
