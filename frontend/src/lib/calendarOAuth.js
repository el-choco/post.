export function oauthBaseUrl(provider, value) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const local = ["localhost", "127.0.0.1", "::1"].includes(host);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname) ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      (provider === "google" &&
        !local &&
        (/^\d+\.\d+\.\d+\.\d+$/.test(host) ||
          host.includes(":") ||
          !host.includes(".")))
    )
      return "";
    return url.origin;
  } catch {
    return "";
  }
}
export function oauthCallbackUrl(provider, value) {
  const base = oauthBaseUrl(provider, value);
  return base ? base + "/api/calendar/oauth/" + provider + "/callback" : "";
}
