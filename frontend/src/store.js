import { create } from "zustand";
import { normalizeAppearance } from "./lib/appearance.js";

function readStoredUser() {
  try {
    const storedUser = localStorage.getItem("user");
    const user = storedUser ? JSON.parse(storedUser) : null;
    if (user && !user.demo && !user.id) {
      localStorage.removeItem("user");
      return null;
    }
    return user;
  } catch {
    localStorage.removeItem("user");
    return null;
  }
}

function appearanceKey(user) {
  return user
    ? `post:appearance:${user.demo ? "demo" : user.email || user.id}`
    : null;
}
function readAppearance(user) {
  try {
    const key = appearanceKey(user);
    return normalizeAppearance(
      key ? JSON.parse(localStorage.getItem(key)) : null,
    );
  } catch {
    return normalizeAppearance(null);
  }
}
const initialUser = readStoredUser();
export const useStore = create((set, get) => ({
  user: initialUser,
  setUser: (user) => {
    localStorage.setItem("user", JSON.stringify(user));
    set({ user, appearance: readAppearance(user), appearancePreview: null });
  },
  logout: () => {
    localStorage.removeItem("user");
    set({
      user: null,
      appearance: normalizeAppearance(null),
      appearancePreview: null,
    });
  },
  appearance: readAppearance(initialUser),
  appearancePreview: null,
  setAppearance: (value) => {
    const appearance = normalizeAppearance(value),
      key = appearanceKey(get().user);
    try {
      if (key) localStorage.setItem(key, JSON.stringify(appearance));
    } catch {}
    set({ appearance, appearancePreview: null });
  },
  previewAppearance: (value) =>
    set({ appearancePreview: value ? normalizeAppearance(value) : null }),
  darkMode: localStorage.getItem("theme") === "dark",
  toggleDarkMode: () =>
    set((state) => {
      const newTheme = !state.darkMode;
      localStorage.setItem("theme", newTheme ? "dark" : "light");
      return { darkMode: newTheme };
    }),
  layout: localStorage.getItem("layout") || "right",
  setLayout: (layout) => {
    localStorage.setItem("layout", layout);
    set({ layout });
  },
  pageSize: parseInt(localStorage.getItem("pageSize")) || 25,
  setPageSize: (pageSize) => {
    localStorage.setItem("pageSize", pageSize);
    set({ pageSize });
  },
}));
