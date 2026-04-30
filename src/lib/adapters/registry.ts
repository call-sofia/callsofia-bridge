import type { CrmAdapter } from "./types";

export type AdapterName = "litify" | "generic-webhook" | "none";
const VALID_NAMES: AdapterName[] = ["litify", "generic-webhook", "none"];

export function selectAdapterName(name: string): AdapterName {
  if (!VALID_NAMES.includes(name as AdapterName)) throw new Error(`Unknown adapter: ${name}`);
  return name as AdapterName;
}

let _cached: CrmAdapter | null = null;

export async function getAdapter(name: AdapterName): Promise<CrmAdapter> {
  if (_cached && _cached.name === name) return _cached;
  switch (name) {
    case "litify": {
      const path = "./litify/adapter";
      const mod = (await import(/* @vite-ignore */ path)) as {
        LitifyAdapter: new () => CrmAdapter;
      };
      _cached = new mod.LitifyAdapter();
      break;
    }
    case "generic-webhook": {
      const path = "./generic-webhook/adapter";
      const mod = (await import(/* @vite-ignore */ path)) as {
        GenericWebhookAdapter: new () => CrmAdapter;
      };
      _cached = new mod.GenericWebhookAdapter();
      break;
    }
    case "none":
      _cached = {
        name: "none",
        async init() {},
        async handle() { return { outcome: "noop" as const }; },
        async healthCheck() { return { healthy: true, timestamp: new Date() }; },
      };
      break;
  }
  await _cached!.init();
  return _cached!;
}
