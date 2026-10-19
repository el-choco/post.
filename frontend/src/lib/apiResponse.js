export function apiFailure(response, fallback = "apiInvalidResponse") {
  const error = new Error(
    response.status === 504 || response.status === 408
      ? "apiTimeout"
      : [502, 503].includes(response.status)
        ? "apiUnavailable"
        : fallback,
  );
  error.status = response.status;
  error.requestId = (response.headers.get("x-request-id") || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return error;
}
export async function readApiResponse(response) {
  const body = await response.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw apiFailure(response);
  }
  if (!response.ok) {
    const error = apiFailure(response, "error");
    if (typeof data?.error === "string" && data.error)
      error.message = data.error;
    if (typeof data?.code === "string") error.code = data.code;
    if (
      response.status === 409 &&
      data?.code === "ATTACHMENT_NAME_CONFLICT" &&
      typeof data.conflict?.name === "string"
    )
      error.conflict = {
        name: data.conflict.name.slice(0, 1000),
        canReplace: data.conflict.canReplace === true,
        token:
          typeof data.conflict.token === "string"
            ? data.conflict.token.slice(0, 10000)
            : "",
      };
    throw error;
  }
  return data;
}
export function mailStatesChanged(before, states) {
  if (!before) return true;
  return states.some((state) => {
    const old = before.get(state.folder);
    return (
      !old ||
      ["total", "unseen", "uidNext", "uidValidity", "highestModseq"].some(
        (key) => old[key] !== state[key],
      )
    );
  });
}
