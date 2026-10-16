const IDLE_CONNECTION_MS = 5 * 60000;
const SOCKET_TIMEOUT_MS = IDLE_CONNECTION_MS + 60000;
async function connectImap(client, trace) {
  const connecting = client.connect();
  const socket = client.socket;
  if (!trace || !socket?.once || !socket?.removeListener) return connecting;
  const finishNetwork = trace.start("network");
  let finishSession;
  const connected = () => {
    finishNetwork();
    finishSession = trace.start("session");
  };
  const event = socket.encrypted ? "secureConnect" : "connect";
  socket.once(event, connected);
  try {
    return await connecting;
  } finally {
    socket.removeListener(event, connected);
    finishNetwork();
    finishSession?.();
  }
}
module.exports = { connectImap, IDLE_CONNECTION_MS, SOCKET_TIMEOUT_MS };
