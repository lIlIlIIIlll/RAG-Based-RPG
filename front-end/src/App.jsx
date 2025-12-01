import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./components/AuthPage.jsx";
import ChatInterface from "./components/ChatInterface.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import PublicRoute from "./components/PublicRoute.jsx";

function App() {
  return (
    <Routes>
      <Route element={<PublicRoute />}>
        <Route path="/" element={<AuthPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/chat" element={<ChatInterface />} />
        <Route path="/c/:chatId" element={<ChatInterface />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;