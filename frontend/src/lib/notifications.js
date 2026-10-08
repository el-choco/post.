export function playSound() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  const ctx = new Context();
  const tone = ctx.createOscillator(),
    gain = ctx.createGain();
  tone.connect(gain);
  gain.connect(ctx.destination);
  tone.frequency.setValueAtTime(740, ctx.currentTime);
  tone.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.07, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
  tone.start();
  tone.stop(ctx.currentTime + 0.5);
  tone.onended = () => ctx.close();
}
export async function desktopNotification(
  title,
  body,
  duration = 5,
  request = false,
) {
  if (!("Notification" in window)) return false;
  if (request && Notification.permission === "default")
    await Notification.requestPermission();
  if (Notification.permission !== "granted") return false;
  const notification = new Notification(title, { body, tag: "post-new-mail" });
  if (duration) setTimeout(() => notification.close(), duration * 1000);
  return true;
}
