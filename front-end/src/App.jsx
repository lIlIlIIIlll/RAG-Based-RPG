import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AuthPage from "./components/AuthPage.jsx";
import ChatInterface from "./components/ChatInterface.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import PublicRoute from "./components/PublicRoute.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import { ConfirmationProvider } from "./context/ConfirmationContext.jsx";

function App() {
  return (
    <ToastProvider>
      <ConfirmationProvider>
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
      </ConfirmationProvider>
    </ToastProvider>
  );
}

export default App;