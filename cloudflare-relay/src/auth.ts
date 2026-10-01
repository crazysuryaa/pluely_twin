export type SessionRole = "host" | "commenter";

type SessionTokenPayload = {
  session_id: string;
  role: SessionRole;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signSessionToken(
  secret: string,
  sessionId: string,
  role: SessionRole,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload: SessionTokenPayload = {
    session_id: sessionId,
    role,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encodedPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  );
  const signingInput = `${header}.${encodedPayload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      await importHmacKey(secret),
      encoder.encode(signingInput),
    ),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function verifySessionToken(
  secret: string,
  token: string,
  expectedSessionId: string,
  expectedRole: SessionRole,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [header, encodedPayload, encodedSignature] = parts;

  try {
    const headerValue = JSON.parse(
      decoder.decode(base64UrlDecode(header)),
    ) as { alg?: string; typ?: string };

    if (headerValue.alg !== "HS256") return false;

    const signingInput = `${header}.${encodedPayload}`;
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      await importHmacKey(secret),
      toArrayBuffer(base64UrlDecode(encodedSignature)),
      encoder.encode(signingInput),
    );

    if (!validSignature) return false;

    const payload = JSON.parse(
      decoder.decode(base64UrlDecode(encodedPayload)),
    ) as Partial<SessionTokenPayload>;

    const now = Math.floor(Date.now() / 1000);
    return (
      payload.session_id === expectedSessionId &&
      payload.role === expectedRole &&
      typeof payload.exp === "number" &&
      payload.exp > now
    );
  } catch {
    return false;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }

  return diff === 0;
}
