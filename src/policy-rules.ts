import { z } from 'zod';

const text = z.string().trim().min(1).max(4096);
export const policyRuleTypeSchema = z.enum([
  'hash', 'filename', 'filepath', 'publisher', 'fileattrib', 'browser_extension',
  'packagefamilyname', 'amsi', 'path', 'team_id', 'signing_id', 'cdhash',
  'app_bundle', 'bundle_id', 'scr', 'asr', 'package',
]);
const stringValue = z.union([
  text,
  z.strictObject({
    value: text.optional(), name: text.optional(), path: text.optional(),
    id: text.optional(), rule_id: text.optional(),
    packageFamilyName: text.optional(), package_family_name: text.optional(),
  }).refine((value) => Object.values(value).some(Boolean), 'A non-empty rule value is required'),
]);
const hash = z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{40}|[a-f\d]{64})$/i);
const tbsHash = z.string().regex(/^(?:[a-f\d]{32}|[a-f\d]{40}|[a-f\d]{64}|[a-f\d]{96})$/i);
const publisherValue = z.strictObject({
  publisherName: text.optional(), publisher: text.optional(),
  signerName: text.optional(), signer: text.optional(),
  tbsHash: tbsHash.optional(), tbs_hash: tbsHash.optional(), certificate_thumbprint: tbsHash.optional(),
  certRuleLevel: z.enum(['publisher', 'filepublisher', 'pcacertificate', 'leafcertificate']).optional(),
  cert_rule_level: z.enum(['publisher', 'filepublisher', 'pcacertificate', 'leafcertificate']).optional(),
}).refine((value) => Boolean(value.publisherName ?? value.publisher), 'publisherName or publisher is required')
  .refine((value) => Boolean(value.tbsHash ?? value.tbs_hash ?? value.certificate_thumbprint), 'A valid TBS hash is required');
const browserValue = z.strictObject({
  extensionId: text.optional(), extension_id: text.optional(),
  browser: z.enum(['chrome', 'edge', 'firefox', 'safari']).optional(),
  name: text.optional(), extension_name: text.optional(), version: text.optional(),
}).refine((value) => Boolean(value.extensionId ?? value.extension_id), 'extensionId is required');
const objectValue = z.record(z.string(), z.json()).refine((value) => Object.keys(value).length > 0, 'An object value must not be empty');
const metadata = {
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['allowed', 'blocked', 'disabled', 'prompt']).optional().describe('Defaults to blocked for explicit rules'),
  source: text.optional().describe('The Portal assigns customer API provenance; this cannot override it'),
  min_version: text.nullable().optional(), max_version: text.nullable().optional(),
  mode: z.enum(['user', 'kernel', 'both']).nullable().optional(),
  linked_signer_id: text.nullable().optional(),
  file_attrib_refs: z.array(text).max(256).nullable().optional(),
  package_version: text.nullable().optional(),
  target_platforms: z.array(z.enum(['windows', 'macos', 'linux'])).min(1).max(3).nullable().optional(),
};

// Keep the strict rule envelope separate from platform-specific enforcement,
// which remains the Portal's authority once the target policy is resolved.
export const policyRuleSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...metadata, type: z.literal('filename'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('filepath'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('path'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('fileattrib'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('team_id'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('signing_id'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('bundle_id'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('app_bundle'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('cdhash'), value: stringValue.refine((value) => {
    const candidate = typeof value === 'string' ? value
      : value.value ?? value.name ?? value.path ?? value.id ?? value.rule_id ?? value.packageFamilyName ?? value.package_family_name;
    return /^[a-f\d]{40}$/i.test(candidate ?? '');
  }, 'cdhash rules require a 40-character hex value') }),
  z.strictObject({ ...metadata, type: z.literal('hash'), value: z.union([
    hash, z.strictObject({ SHA256: hash.optional(), SHA1: hash.optional(), MD5: hash.optional(), hash: hash.optional() })
      .refine((value) => Object.values(value).some(Boolean), 'A hash value is required'),
  ]) }),
  z.strictObject({ ...metadata, type: z.literal('publisher'), value: publisherValue }),
  z.strictObject({ ...metadata, type: z.literal('browser_extension'), value: browserValue }),
  z.strictObject({ ...metadata, type: z.literal('packagefamilyname'), value: z.union([
    text, z.strictObject({ packageFamilyName: text.optional(), package_family_name: text.optional(), name: text.optional(), version: text.optional(), publisher: text.optional() })
      .refine((value) => Boolean(value.packageFamilyName ?? value.package_family_name), 'packageFamilyName is required'),
  ]) }),
  z.strictObject({ ...metadata, type: z.literal('package'), value: z.union([
    text, z.strictObject({ name: text, manager: text.optional(), version: text.optional() }),
  ]) }),
  z.strictObject({ ...metadata, type: z.literal('amsi'), value: stringValue }),
  z.strictObject({ ...metadata, type: z.literal('scr'), value: z.union([text, objectValue]) }),
  z.strictObject({ ...metadata, type: z.literal('asr'), value: z.union([text, objectValue]) }),
]).describe('Explicit Customer API rule with type, value and optional status/metadata. Filename example: {type:"filename", value:"rustdesk.exe", status:"blocked"}. Windows WDAC flat hash rules are rejected by the Portal; use event_ids or private intelligence feeds.');

export type PolicyRuleInput = z.infer<typeof policyRuleSchema>;

export const addPolicyRulesResultSchema = z.object({
  success: z.literal(true).optional(),
  added_count: z.number().int().nonnegative(),
  updated_count: z.number().int().nonnegative(),
  duplicate_count: z.number().int().nonnegative(),
}).passthrough();
