import jsforce, { Connection } from "jsforce";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";

export class LitifyAuth {
  private conn: Connection | null = null;
  private expiresAt = 0;

  async getConnection(): Promise<Connection> {
    if (this.conn && Date.now() < this.expiresAt) return this.conn;

    const cfg = config().salesforce;
    if (!cfg) throw new Error("Salesforce config missing");

    const conn = new jsforce.Connection({ loginUrl: cfg.loginUrl });
    await conn.login(cfg.username, cfg.password + cfg.securityToken);
    this.conn = conn;
    this.expiresAt = Date.now() + 90 * 60 * 1000; // 90 min
    logger.info("litify_auth_logged_in", { instance: conn.instanceUrl });
    return conn;
  }

  async ping(): Promise<boolean> {
    try {
      const conn = await this.getConnection();
      await conn.query("SELECT Id FROM User LIMIT 1");
      return true;
    } catch (err) {
      logger.error("litify_ping_failed", { err: (err as Error).message });
      return false;
    }
  }
}

export const litifyAuth = new LitifyAuth();
