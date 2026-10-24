"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

/**
 * Where the journal's API calls get their extra headers. The owner's journal sends none
 * (the server uses its own keys); a visitor workspace sends its credentials from sessionStorage.
 */
const HeadersContext = createContext<() => Record<string, string>>(() => ({}));

export function ApiProvider({ headers, children }: { headers: () => Record<string, string>; children: ReactNode }) {
  return <HeadersContext.Provider value={headers}>{children}</HeadersContext.Provider>;
}

/** fetch() with the current journal's headers added. */
export function useApiFetch() {
  const getHeaders = useContext(HeadersContext);
  return useCallback(
    (url: string, init: RequestInit = {}) =>
      fetch(url, { ...init, headers: { ...getHeaders(), ...(init.headers as Record<string, string> | undefined) } }),
    [getHeaders],
  );
}
