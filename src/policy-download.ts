import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { readPolicyZip } from './policy-zip.js';

export type PolicyDownloadFormat = 'wdac' | 'applocker';
export const POLICY_DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;
const MAX_XML_BYTES = 30 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PolicyDownload {
  bytes: Buffer;
  format: PolicyDownloadFormat;
  versionId: string;
  fileCount: number;
  sha256: string;
  projectionSummary?: Record<string, unknown>;
}

function validateXml(bytes: Uint8Array, root: string): void {
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new Error('Invalid policy XML.');
  }
  // FXP ignores text outside a document root. Wrapping the already validated
  // input makes leading/trailing text observable instead of silently dropping it.
  const body = xml.replace(/^\uFEFF/, '').replace(/^\s*<\?xml\b[^?]*\?>/, '');
  const wrapped = new XMLParser({ preserveOrder: true, ignoreDeclaration: true,
    ignorePiTags: true, processEntities: false, maxNestedTags: 256 })
    .parse(`<_MagicSwordPolicyDocument_>${body}</_MagicSwordPolicyDocument_>`);
  const parsed: unknown = wrapped[0]?._MagicSwordPolicyDocument_;
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] ||
      !Object.hasOwn(parsed[0], root) || Object.keys(parsed[0]).some(key => key !== root && key !== ':@')) {
    throw new Error('Unexpected policy XML format.');
  }
}

/** Validate the complete response before touching the user's output directory. */
export function validatePolicyDownload(
  bytes: Buffer, format: PolicyDownloadFormat, headers: Record<string, string | string[] | undefined>,
): PolicyDownload {
  const header = (name: string) => {
    const value = headers[name];
    return typeof value === 'string' ? value : '';
  };
  const mime = header('content-type').split(';')[0].trim().toLowerCase();
  const versionId = header('x-magicsword-policy-version-id');
  if (!UUID.test(versionId) || !bytes.length || bytes.length > POLICY_DOWNLOAD_MAX_BYTES ||
      mime !== (format === 'wdac' ? 'application/zip' : 'application/xml')) {
    throw new Error('Invalid policy download response.');
  }
  let fileCount = 1;
  if (format === 'wdac') {
    const files = readPolicyZip(bytes);
    fileCount = files.length;
    if (!fileCount || String(fileCount) !== header('x-magicsword-policy-xml-file-count')) {
      throw new Error('WDAC archive file count could not be verified.');
    }
    for (const xml of files) validateXml(xml, 'SiPolicy');
  } else {
    if (bytes.length > MAX_XML_BYTES) throw new Error('AppLocker XML exceeds the size limit.');
    validateXml(bytes, 'AppLockerPolicy');
  }
  let projectionSummary: Record<string, unknown> | undefined;
  const summary = header('x-magicsword-applocker-projection-summary');
  if (format === 'applocker' && !summary) throw new Error('Missing AppLocker projection summary.');
  if (summary) {
    if (summary.length > 8192) throw new Error('Invalid policy projection summary.');
    const parsed: unknown = JSON.parse(summary);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid policy projection summary.');
    projectionSummary = parsed as Record<string, unknown>;
  }
  return { bytes, format, versionId: versionId.toLowerCase(), fileCount,
    sha256: createHash('sha256').update(bytes).digest('hex'), projectionSummary };
}

export function policyDownloadDirectory(input?: string): string {
  if (input === undefined) return join(homedir(), 'Downloads');
  if (!input || /[\u0000-\u001f\u007f]/.test(input)) throw new Error('Invalid output directory.');
  const expanded = input === '~' ? homedir() : /^~[\\/]/.test(input) ? join(homedir(), input.slice(2)) : input;
  if (!isAbsolute(expanded)) throw new Error('Output directory must be an absolute path or start with ~/.');
  return resolve(expanded);
}

/** Exclusive creation prevents overwriting existing files and final-path symlinks. */
export async function savePolicyDownload(download: PolicyDownload, policyId: string, directory: string): Promise<string> {
  if (!UUID.test(policyId)) throw new Error('Invalid policy ID.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stem = `magicsword-${download.format}-${policyId.toLowerCase()}-${download.versionId}`;
  const extension = download.format === 'wdac' ? '.zip' : '.applocker.xml';
  for (let suffix = 0; suffix < 100; suffix++) {
    const path = join(directory, `${stem}${suffix ? `-${suffix + 1}` : ''}${extension}`);
    const file = await open(path, 'wx', 0o600).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
      throw error;
    });
    if (!file) continue;
    try {
      await file.writeFile(download.bytes);
      await file.sync();
      await file.close();
      return path;
    } catch (error) {
      await file.close().catch(() => {});
      await unlink(path).catch(() => {});
      throw error;
    }
  }
  throw new Error('Too many existing policy downloads in this directory.');
}
