import { create } from "zustand";

function readStoredUser() {
  try {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    // A stale or manually edited value must not prevent the app from mounting.
    localStorage.removeItem("user");
    return null;
  }
}

export const useStore = create((set) => ({
  user: readStoredUser(),
  setUser: (user) => {
    localStorage.setItem("user", JSON.stringify(user));
    set({ user });
  },
  logout: () => {
    localStorage.removeItem("user");
    set({ user: null });
  },
  darkMode: localStorage.getItem("theme") === "dark",
  toggleDarkMode: () =>
    set((state) => {
      const newTheme = !state.darkMode;
      localStorage.setItem("theme", newTheme ? "dark" : "light");
      return { darkMode: newTheme };
    }),
  layout: localStorage.getItem("layout") || "right", // 'right', 'bottom', 'list'
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
