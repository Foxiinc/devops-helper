export function formatBackendError(err: unknown): string {
  const msg = String(err);
  if (/command\s+\w+\s+not found/i.test(msg)) {
    return "Rust backend is outdated. Stop the app, then run: npm run tauri dev";
  }
  if (/crypto error|cannot be decrypted|aead/i.test(msg)) {
    return "Stored credentials cannot be decrypted. Edit the server and re-enter the password, or re-import the SSH key in Settings → Keys.";
  }
  return msg;
}
