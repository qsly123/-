const EMBED_HTML_BODY_STYLE = "margin:0;";

export const SANDBOXED_HTML_CARD_IFRAME_PROPS = {
  sandbox: "allow-top-navigation-by-user-activation",
} as const;

export const SANDBOXED_HTML_INTERACTIVE_IFRAME_PROPS = {
  sandbox: "allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation",
} as const;

export function buildSandboxedHtmlCardDocument(content: string) {
  const html = String(content || "");
  return `<!doctype html><html><head><meta charset="utf-8" /><base target="_top" /></head><body style="${EMBED_HTML_BODY_STYLE}">${html}</body></html>`;
}
