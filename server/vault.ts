import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ConcreteProviderId } from '../src/types/studio.ts';

interface VaultDiskData {
  masterKeyHex: string;
  entries: Record<string, { iv: string; tag: string; ciphertext: string }>;
}

const VAULT_FILE = path.resolve(process.cwd(), '.scopex-vault.json');

const ALLOWED_VAULT_KEYS = ['groq', 'nvidia', 'pollinations', 'gemini_image'] as const;
export type ImageVaultSecretId = 'pollinations' | 'gemini_image';

function loadOrCreateVault(): VaultDiskData {
  try {
    if (fs.existsSync(VAULT_FILE)) {
      const raw = fs.readFileSync(VAULT_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rawEntries = parsed.entries as Record<string, { iv: string; tag: string; ciphertext: string }> | undefined;
      if (parsed && typeof parsed.masterKeyHex === 'string' && rawEntries && typeof rawEntries === 'object') {
        const cleanedEntries: VaultDiskData['entries'] = {};
        for (const keyName of ALLOWED_VAULT_KEYS) {
          if (rawEntries[keyName]) cleanedEntries[keyName] = rawEntries[keyName];
        }
        const cleaned: VaultDiskData = {
          masterKeyHex: parsed.masterKeyHex,
          entries: cleanedEntries,
        };
        const allowedSet = new Set<string>(ALLOWED_VAULT_KEYS);
        const hasExtraEntries = Object.keys(rawEntries).some((k) => !allowedSet.has(k));
        const hasExtraRoot = Object.keys(parsed).some((k) => k !== 'masterKeyHex' && k !== 'entries');
        if (hasExtraEntries || hasExtraRoot) {
          try {
            fs.writeFileSync(VAULT_FILE, JSON.stringify(cleaned, null, 2), { mode: 0o600 });
          } catch {
            // Non-fatal
          }
        }
        return cleaned;
      }
    }
  } catch {
    // Recreate vault if corrupted
  }
  const masterKeyHex = crypto.randomBytes(32).toString('hex');
  const initial: VaultDiskData = { masterKeyHex, entries: {} };
  try {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(initial, null, 2), { mode: 0o600 });
  } catch {
    // Non-fatal in read-only environments; kept in memory
  }
  return initial;
}

let vaultData: VaultDiskData = loadOrCreateVault();

function saveVault(): void {
  try {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultData, null, 2), { mode: 0o600 });
  } catch {
    // Keep in-memory state if filesystem write fails
  }
}

function encryptSecret(plaintext: string): { iv: string; tag: string; ciphertext: string } {
  const key = Buffer.from(vaultData.masterKeyHex, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: encrypted.toString('hex'),
  };
}

function decryptSecret(entry: { iv: string; tag: string; ciphertext: string }): string {
  const key = Buffer.from(vaultData.masterKeyHex, 'hex');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(entry.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(entry.tag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

export function setProviderSecret(
  provider: Exclude<ConcreteProviderId, 'gemini'>,
  apiKey: string | null
): void {
  if (apiKey === null) {
    delete vaultData.entries[provider];
  } else if (apiKey.trim()) {
    vaultData.entries[provider] = encryptSecret(apiKey.trim());
  }
  saveVault();
}

export function setImageProviderSecret(
  provider: ImageVaultSecretId,
  apiKey: string | null
): void {
  if (apiKey === null) {
    delete vaultData.entries[provider];
  } else if (apiKey.trim()) {
    vaultData.entries[provider] = encryptSecret(apiKey.trim());
  }
  saveVault();
}

export function getImageProviderKey(
  provider: ImageVaultSecretId
): { key: string | null; source: 'env' | 'vault' | 'none' } {
  if (provider === 'pollinations') {
    const envKey = process.env.POLLINATIONS_API_KEY?.trim();
    if (envKey) {
      return { key: envKey, source: 'env' };
    }
    const stored = vaultData.entries.pollinations;
    if (stored) {
      try {
        return { key: decryptSecret(stored), source: 'vault' };
      } catch {
        return { key: null, source: 'none' };
      }
    }
    return { key: null, source: 'none' };
  }

  const dedicatedEnv = process.env.GEMINI_IMAGE_API_KEY?.trim();
  if (dedicatedEnv && dedicatedEnv !== 'MY_GEMINI_API_KEY') {
    return { key: dedicatedEnv, source: 'env' };
  }
  const stored = vaultData.entries.gemini_image;
  if (stored) {
    try {
      return { key: decryptSecret(stored), source: 'vault' };
    } catch {
      // fall through to GEMINI_API_KEY
    }
  }
  const primaryEnv = process.env.GEMINI_API_KEY?.trim();
  if (primaryEnv && primaryEnv !== 'MY_GEMINI_API_KEY') {
    return { key: primaryEnv, source: 'env' };
  }
  return { key: null, source: 'none' };
}

export function getProviderKey(
  provider: ConcreteProviderId
): { key: string | null; source: 'env' | 'vault' | 'none' } {
  if (provider === 'gemini') {
    const envKey = process.env.GEMINI_API_KEY?.trim();
    if (envKey && envKey !== 'MY_GEMINI_API_KEY') {
      return { key: envKey, source: 'env' };
    }
    return { key: null, source: 'none' };
  }

  const envMap: Record<Exclude<ConcreteProviderId, 'gemini'>, string | undefined> = {
    groq: process.env.GROQ_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
  };

  const envVal = envMap[provider]?.trim();
  if (envVal) {
    return {
      key: envVal,
      source: 'env',
    };
  }

  const stored = vaultData.entries[provider];
  if (stored) {
    try {
      const decrypted = decryptSecret(stored);
      return {
        key: decrypted,
        source: 'vault',
      };
    } catch {
      return { key: null, source: 'none' };
    }
  }

  return {
    key: null,
    source: 'none',
  };
}
