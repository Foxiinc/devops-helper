export function formatBackendError(err: unknown): string {
  const msg = String(err);
  if (/command\s+\w+\s+not found/i.test(msg)) {
    return "Rust backend is outdated. Stop the app, then run: npm run tauri dev";
  }
  if (/master encryption key is missing/i.test(msg)) {
    return "Encryption key file is missing. Edit each server and re-enter the password, or restore master.key from backup.";
  }
  if (/stored server password cannot be decrypted/i.test(msg)) {
    return "Server password cannot be decrypted (encryption key changed). Right-click the server → Edit… → enter the password again → Save.";
  }
  if (/stored SSH private key cannot be decrypted/i.test(msg)) {
    return "SSH key cannot be decrypted (encryption key changed). Settings → Keys → delete the key → import or generate again → re-select it on the server.";
  }
  if (/crypto error|cannot be decrypted|aead/i.test(msg)) {
    return "Stored credentials cannot be decrypted. Edit the server and re-enter the password, or re-import the SSH key in Settings → Keys.";
  }
  return msg;
}

export function isCredentialDecryptError(err: unknown): boolean {
  return /cannot be decrypted|aead|master encryption key is missing/i.test(String(err));
}

export function needsPasswordPrompt(err: unknown, authType?: string): boolean {
  if (authType && authType !== "password") return false;
  const msg = String(err);
  return (
    /password required/i.test(msg) ||
    /stored server password cannot be decrypted/i.test(msg) ||
    /no password stored/i.test(msg) ||
    /crypto error:.*decrypt/i.test(msg) ||
    /cannot be decrypted/i.test(msg)
  );
}
