const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (data: Uint8Array) => {
  let binary = '';
  data.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const fromBase64 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const getKeyMaterial = (password: string) =>
  crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']);

export const generateSalt = (length = 16) => {
  const salt = new Uint8Array(length);
  crypto.getRandomValues(salt);
  return toBase64(salt);
};

export const generateIv = (length = 12) => {
  const iv = new Uint8Array(length);
  crypto.getRandomValues(iv);
  return toBase64(iv);
};

export const deriveKeyAndHash = async (password: string, saltBase64: string, iterations = 100000) => {
  const salt = fromBase64(saltBase64);
  const keyMaterial = await getKeyMaterial(password);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  const hashBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { key, hash: toBase64(new Uint8Array(hashBits)), iterations };
};

export const encryptWithKey = async (plainText: string, key: CryptoKey) => {
  const iv = generateIv();
  const ivBytes = fromBase64(iv);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    encoder.encode(plainText)
  );
  return { cipherText: toBase64(new Uint8Array(cipherBuffer)), iv };
};

export const decryptWithKey = async (cipherTextBase64: string, ivBase64: string, key: CryptoKey) => {
  const cipherBytes = fromBase64(cipherTextBase64);
  const iv = fromBase64(ivBase64);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBytes
  );
  return decoder.decode(plainBuffer);
};
