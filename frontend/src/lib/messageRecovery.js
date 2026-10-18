export function isMissingMessage(error) {
  return (
    error?.status === 404 &&
    (!error.endpoint || error.endpoint === "/message") &&
    (error.code === "MESSAGE_NOT_FOUND" ||
      error.message === "Message not found")
  );
}
export function clearMissingMessageRoute(current, message) {
  if (
    current.get("view") !== "message" ||
    Number(current.get("uid")) !== message.uid ||
    (current.get("folder") || "INBOX") !== message.folder
  )
    return current;
  const next = new URLSearchParams(current);
  next.delete("view");
  next.delete("uid");
  next.delete("folder");
  return next;
}
