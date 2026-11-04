/** The API server as this Next server reaches it (proxy.ts forwards /api there; server components fetch from it). */
export const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:3001";
