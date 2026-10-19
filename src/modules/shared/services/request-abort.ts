export function isExpectedRequestAbortError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const payload = error as {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim().toLowerCase() : "";

  if (code === "ECONNRESET" || code === "ABORT_ERR" || name === "AbortError") {
    return true;
  }

  if (
    message === "aborted"
    || message.includes("request aborted")
    || message.includes("socket hang up")
  ) {
    return true;
  }

  const cause = payload.cause;
  if (cause && typeof cause === "object" && cause !== error) {
    return isExpectedRequestAbortError(cause);
  }

  return false;
}
