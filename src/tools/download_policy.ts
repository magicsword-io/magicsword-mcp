import { z } from 'zod';
import { MagicSwordApiError } from '../client.js';
import { policyDownloadDirectory, savePolicyDownload } from '../policy-download.js';
import { defineTool, textError, textOk } from './shared.js';

export const downloadPolicyTool = defineTool({
  name: 'download_policy', title: 'Download a generated Windows policy', strictInput: true,
  description:
    'Download the current Windows policy as a WDAC XML ZIP (format=wdac, default) or compatible AppLocker XML (format=applocker). ' +
    'Requires policies:read and Enterprise agentless deployment access. Saves on the machine running this local MCP server, ' +
    'in ~/Downloads by default or an explicitly requested absolute output_directory. Creates a new file without overwriting existing files. ' +
    'Returns the saved path, SHA256, version and byte count. AppLocker is a blocklist projection: review omitted rules before deployment. ' +
    'Preserves audit/enforcing mode; downloading does not install, assign, compile or enforce a policy. Never execute the downloaded file.',
  inputSchema: {
    policy_id: z.string().uuid().transform(value => value.toLowerCase()).describe('Windows policy ID from list_policies'),
    format: z.enum(['wdac', 'applocker']).default('wdac').describe('WDAC ZIP or AppLocker XML'),
    output_directory: z.string().min(1).max(4096).optional().describe('Optional absolute local directory or ~/ path; defaults to ~/Downloads'),
  },
  async handler({ policy_id, format, output_directory }, { client }) {
    let directory: string;
    try { directory = policyDownloadDirectory(output_directory); }
    catch { return textError('Use an absolute output_directory or a ~/ path. The default is ~/Downloads.'); }
    try {
      const download = await client.downloadPolicy(policy_id, format);
      const path = await savePolicyDownload(download, policy_id, directory);
      const warning = format === 'applocker'
        ? ' AppLocker is a blocklist projection; review the projection summary for omitted rules before deployment.' :
          ' WDAC XML must be reviewed and compiled using Windows tooling before deployment.';
      return textOk(`Saved ${format === 'wdac' ? 'WDAC XML archive' : 'AppLocker XML'} to ${path} ` +
        `(${download.bytes.length} bytes, ${download.fileCount} XML files). SHA256: ${download.sha256}.` +
        warning + ' Nothing was installed or assigned.', {
        policy_id, format, path, bytes: download.bytes.length, sha256: download.sha256,
        current_version_id: download.versionId, xml_file_count: download.fileCount,
        ...(download.projectionSummary ? { projection_summary: download.projectionSummary } : {}),
      });
    } catch (error) {
      if (error instanceof MagicSwordApiError) {
        const help: Record<number, string> = {
          401: 'Check the API key.', 403: 'Requires policies:read and Enterprise agentless deployment access.',
          404: 'Check the policy ID and organization.', 409: 'The policy changed; retry the download.',
          413: 'The generated artifact exceeds the size limit.', 422: 'The policy has no supported export for this format.',
          503: 'Generation is temporarily unavailable; retry later.',
        };
        return textError(`Policy download failed (HTTP ${error.status}). ${help[error.status] ?? 'Retry later.'}`);
      }
      return textError('Could not download and save the policy. Check the destination directory permissions and available disk space, then retry.');
    }
  },
});
