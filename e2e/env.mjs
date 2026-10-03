// Ports and URLs for the isolated E2E stack (never the dev servers on 4000/5173).
export const E2E = {
  apiPort: 4100,
  webPort: 5174,
  apiOrigin: 'http://localhost:4100',
  webOrigin: 'http://localhost:5174',
  databaseUrl:
    process.env.E2E_DATABASE_URL ??
    'postgresql://focusguard:focusguard@localhost:5432/focusguard_e2e',
  extensionId: 'dmfegmfpjfegcdhojmpbbghakajhgpec',
};
