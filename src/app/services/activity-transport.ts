export type ApiActivityListener = (operation: string) => ((success: boolean) => void);
let listener: ApiActivityListener | undefined;

export function setApiActivityListener(value?: ApiActivityListener): void { listener = value; }

// Never inspect headers, query strings, request bodies or response bodies.
export const activityFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const path = url.pathname;
  const audited = /^\/(rest\/v1|auth\/v1|functions\/v1)\/[a-zA-Z0-9_/-]+$/.test(path)
    && !path.endsWith('/record_client_activity');
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  let complete: ((success: boolean) => void) | undefined;
  try { if (audited) complete = listener?.(`${method}:${path}`); } catch { /* Telemetry must never block requests. */ }
  try {
    const response = await fetch(input, init);
    try { complete?.(response.ok); } catch { /* Best effort. */ }
    return response;
  } catch (error) {
    try { complete?.(false); } catch { /* Best effort. */ }
    throw error;
  }
};
