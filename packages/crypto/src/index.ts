import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "node:crypto";

const NONCE_LEN = 12;
const KEY_LEN = 32;

export interface SealedSecret {
  /** key version id, used for rotation */
  kid: string;
  /** base64url ciphertext + GCM auth tag */
  ciphertext: string;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const b64u = {
  encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64url");
  },
  decode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, "base64url"));
  },
};

export class CryptoService {
  private readonly kidToKey = new Map<string, Uint8Array>();
  private readonly activeKid: string;

  /**
   * @param rootKeys mapping of key id -> 32-byte hex master key.
   *                 The first entry is treated as the active key for new
   *                 encryptions; all entries are valid for decryption (lets
   *                 you rotate by adding a new kid and retiring the old later).
   */
  constructor(rootKeys: Record<string, string>) {
    const entries = Object.entries(rootKeys);
    if (entries.length === 0) {
      throw new Error("CryptoService requires at least one root key");
    }
    for (const [kid, hex] of entries) {
      const bytes = hexToBytes(hex);
      if (bytes.length !== KEY_LEN) {
        throw new Error(`Root key '${kid}' must be 32 bytes (got ${bytes.length})`);
      }
      this.kidToKey.set(kid, bytes);
    }
    this.activeKid = entries[0]![0];
  }

  /** Construct from a single env-supplied root key. */
  static fromEnv(rootKeyHex: string, kid = "v1"): CryptoService {
    return new CryptoService({ [kid]: rootKeyHex });
  }

  encrypt(plaintext: string): SealedSecret {
    const key = this.kidToKey.get(this.activeKid);
    if (!key) throw new Error(`Active key '${this.activeKid}' not found`);
    const nonce = randomBytes(NONCE_LEN);
    const stream = gcm(key, nonce, new Uint8Array(0));
    const sealed = stream.encrypt(new TextEncoder().encode(plaintext));
    const out = new Uint8Array(NONCE_LEN + sealed.length);
    out.set(nonce, 0);
    out.set(sealed, NONCE_LEN);
    return { kid: this.activeKid, ciphertext: b64u.encode(out) };
  }

  decrypt(sealed: SealedSecret): string {
    const key = this.kidToKey.get(sealed.kid);
    if (!key) throw new Error(`Unknown key id '${sealed.kid}'`);
    const blob = b64u.decode(sealed.ciphertext);
    if (blob.length < NONCE_LEN) throw new Error("Ciphertext too short");
    const nonce = blob.slice(0, NONCE_LEN);
    const ct = blob.slice(NONCE_LEN);
    const stream = gcm(key, nonce, new Uint8Array(0));
    const pt = stream.decrypt(ct);
    return new TextDecoder().decode(pt);
  }
}