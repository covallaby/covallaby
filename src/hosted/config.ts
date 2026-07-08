/**
 * Hosted-tier configuration. Present only when COVALLABY_HOSTED=1; otherwise
 * the server runs as the single-tenant self-hosted app with none of this
 * mounted. Missing required env in hosted mode fails fast at boot.
 */
export interface HostedConfig {
  baseUrl: string;
  sessionSecret: string;
  github: {
    clientId: string;
    clientSecret: string;
    /** api.github.com by default; a GHES base for self-hosted GitHub. */
    apiBase: string;
  };
  /** Billing is optional even in hosted mode; without it, everything is `free`. */
  stripe: {
    secretKey: string;
    webhookSecret: string;
    priceId: string;
  } | null;
}

export function loadHostedConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig | null {
  if (env.COVALLABY_HOSTED !== "1") return null;

  const need = (key: string): string => {
    const value = env[key]?.trim();
    if (!value) {
      throw new Error(
        `COVALLABY_HOSTED=1 requires ${key}. Set it, or unset COVALLABY_HOSTED to run the self-hosted server.`,
      );
    }
    return value;
  };

  const stripeKey = env.STRIPE_SECRET_KEY?.trim();
  const stripe = stripeKey
    ? {
        secretKey: stripeKey,
        webhookSecret: need("STRIPE_WEBHOOK_SECRET"),
        priceId: need("STRIPE_PRICE_ID"),
      }
    : null;

  return {
    baseUrl: (env.COVALLABY_BASE_URL ?? "http://localhost:8080").replace(/\/$/, ""),
    sessionSecret: need("COVALLABY_SESSION_SECRET"),
    github: {
      clientId: need("GITHUB_CLIENT_ID"),
      clientSecret: need("GITHUB_CLIENT_SECRET"),
      apiBase: (env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/$/, ""),
    },
    stripe,
  };
}
