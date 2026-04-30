import jsforce, { Connection } from "jsforce";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

// Salesforce OAuth 2.0 Client Credentials Flow.
// Spec: https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_client_credentials_flow.htm
// Replaces the legacy username+password+security-token login (`conn.login(...)`).
// Salesforce restricts username login on newer orgs; OAuth Client Credentials is
// the recommended server-to-server flow for connected apps.

interface TokenResponse {
  access_token: string;
  instance_url: string;
  token_type?: string;
  issued_at?: string;
  signature?: string;
  // Note: Salesforce's client_credentials flow does NOT return `expires_in`.
  // Token lifetime is determined by the connected-app's session policy.
  // We refresh on 401 from any subsequent call.
}

export class LitifyAuth {
  private conn: Connection | null = null;
  // Soft expiry: Salesforce session policies vary (15min – 24hr). We pre-emptively
  // refresh after `softTtlMs` to avoid scattering 401-retry logic. A 401 from any
  // call still triggers a hard refresh via `withFreshConnection()`.
  private softExpiresAt = 0;
  private readonly softTtlMs = 60 * 60 * 1000; // 60 min

  async getConnection(): Promise<Connection> {
    if (this.conn && Date.now() < this.softExpiresAt) return this.conn;
    return this.refresh();
  }

  /**
   * Force a token refresh and rebuild the jsforce Connection.
   * Call this on a 401 from any SOQL/REST request.
   */
  async refresh(): Promise<Connection> {
    const cfg = config().salesforce;
    if (!cfg) throw new Error("Salesforce config missing");

    // Deprecation warning if username/password are still set. Bridge will keep
    // accepting them in the env schema for now, but the values are ignored.
    if (cfg.username || cfg.password || cfg.securityToken) {
      logger.warn("litify_auth_legacy_credentials_ignored", {
        hint: "SALESFORCE_USERNAME/PASSWORD/SECURITY_TOKEN are deprecated; using OAuth client credentials. Remove these env vars once rollout is complete.",
      });
    }

    const tokenUrl = `${cfg.loginUrl.replace(/\/$/, "")}/services/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Salesforce OAuth token exchange failed: ${res.status} ${errText}`);
    }

    const token = (await res.json()) as TokenResponse;
    if (!token.access_token || !token.instance_url) {
      throw new Error("Salesforce OAuth response missing access_token or instance_url");
    }

    this.conn = new jsforce.Connection({
      accessToken: token.access_token,
      instanceUrl: token.instance_url,
    });
    this.softExpiresAt = Date.now() + this.softTtlMs;
    logger.info("litify_auth_token_acquired", { instance: token.instance_url });
    return this.conn;
  }

  /**
   * Run a callback with a connection; on a 401, refresh once and retry.
   * Use this around any SOQL/REST call that may hit an expired session.
   */
  async withFreshConnection<T>(fn: (conn: Connection) => Promise<T>): Promise<T> {
    const conn = await this.getConnection();
    try {
      return await fn(conn);
    } catch (err) {
      const e = err as { errorCode?: string; statusCode?: number; message?: string };
      const is401 =
        e.statusCode === 401 ||
        e.errorCode === "INVALID_SESSION_ID" ||
        /INVALID_SESSION_ID|expired/i.test(e.message ?? "");
      if (!is401) throw err;
      logger.warn("litify_auth_session_expired_refreshing");
      const fresh = await this.refresh();
      return await fn(fresh);
    }
  }

  async ping(): Promise<boolean> {
    try {
      return await this.withFreshConnection(async (conn) => {
        await conn.query("SELECT Id FROM User LIMIT 1");
        return true;
      });
    } catch (err) {
      logger.error("litify_ping_failed", { err: (err as Error).message });
      return false;
    }
  }
}

export const litifyAuth = new LitifyAuth();
