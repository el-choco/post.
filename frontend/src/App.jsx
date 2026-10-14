import React, { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import Login from "./pages/Login";
import Mailbox from "./pages/Mailbox";
import { useStore } from "./store";
import { applyAppearance } from "./lib/appearance";
import "./i18n";

function App() {
  const { darkMode, appearance, appearancePreview } = useStore();

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    applyAppearance(
      document.documentElement,
      appearancePreview || appearance,
      darkMode,
    );
  }, [darkMode, appearance, appearancePreview]);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Mailbox />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
