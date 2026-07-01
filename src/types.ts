// Shared response shapes that mirror the Magic Portal /api/public/v1/* JSON.
// Defined here (rather than imported from the portal) so the MCP server stays
// a standalone binary with no monorepo coupling.

export type ApiScope =
  | 'policies:read'
  | 'policies:write'
  | 'alerts:read'
  | 'alerts:write'
  | 'endpoints:read'
  | 'endpoints:write'
  | 'intel:read'
  | 'intel:write'
  | 'tokens:write';

export type Platform = 'windows' | 'macos' | 'linux';

export interface Org {
  id: string;
  name?: string;
  organization_type?: string;
}

export interface MeResponse {
  org: Org;
  key_id: string;
  scopes: ApiScope[];
}

export interface Endpoint {
  id: string;
  computer_name: string | null;
  platform: Platform | string;
  status: string | null;
  compliance_status: string | null;
  installer_version: string | null;
  policy_id: string | null;
  last_checkin: string | null;
  last_heartbeat: string | null;
  created_at: string;
  uninstalled_at: string | null;
}

export interface EndpointsResponse {
  endpoints: Endpoint[];
  total: number;
  limit: number;
  offset: number;
}

export interface PolicyVersion {
  id: string;
  policy_id: string;
  name: string | null;
  version: number | string;
  status?: 'disabled' | 'audit' | 'enforcing' | string | null;
  policy_mode: 'blocklist' | 'strict' | string;
  change_message: string | null;
  updated_at: string;
}

export interface Policy {
  id: string;
  platform: Platform | string;
  current_version: PolicyVersion | null;
  created_at: string;
  updated_at: string;
}

export interface PoliciesResponse {
  policies: Policy[];
}

export interface PolicyDetailResponse {
  policy: Policy;
}

export interface EventRow {
  id: string;
  type: string;
  name: string;
  status: 'audited' | 'blocked' | 'allowed' | string;
  platform?: Platform | string | null;
  computer_name?: string | null;
  endpoint_id?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  file_hash?: string | null;
  publisher?: string | null;
  certificate_thumbprint?: string | null;
  is_signed?: boolean | null;
  intel_match_count?: number | null;
  intel_match_sources?: string[] | null;
  linked_policy_ids?: string[] | null;
  occurrence_count?: number | string | null;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  created_at?: string;
  updated_at?: string;
  data?: Record<string, unknown>;
}

export interface EventsResponse {
  events: EventRow[];
  total: number;
  limit: number;
  offset: number;
  since: string;
}

// Alert shape is permissive — the public /alerts route returns the full row
// (`select('*')`), and we don't want to over-constrain a schema that the
// portal team may extend. Surface what we know, leave the rest as unknown.
export interface Alert {
  id: string;
  organization_id: string;
  endpoint_id?: string | null;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info' | string | null;
  title?: string | null;
  description?: string | null;
  computer_name?: string | null;
  mitre_technique?: string | null;
  mitre_techniques?: string[] | null;
  process_chain?: unknown;
  evidence?: unknown;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  ack_comment?: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface AlertsResponse {
  alerts: Alert[];
  total: number;
  limit: number;
  offset: number;
}

export interface EnrollmentTokenResponse {
  token: string;
  org_id: string;
  expires_at: string;
  ttl_seconds: number;
}

export interface CustomerIntelFeed {
  id: string;
  name: string;
  description?: string | null;
  platforms?: Platform[] | string[] | null;
  is_enabled?: boolean;
  item_count?: number | null;
  entry_count?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerIntelFeedsResponse {
  feeds: CustomerIntelFeed[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface CustomerIntelItem {
  id: string;
  source_id: string;
  data: Record<string, unknown>;
  entry_hash: string;
  status?: string;
  is_deleted?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CustomerIntelItemsResponse {
  items: CustomerIntelItem[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ApiErrorBody {
  error: string;
  feature?: string;
}
