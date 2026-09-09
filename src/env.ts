import dotenv from 'dotenv';
import { z } from 'zod';
import tryParseEnv from './utils';

dotenv.config();

const EnvSchema = z
  .object({
    NODE_ENV: z.string(),
    ALLOWED_ORIGIN: z.string(),
    BAGTAG_ENDPOINT: z.string(),
    CACHE_EXPIRY: z.string(),
    DISCORD_CHANNEL_ID: z.string(),
    DISCORD_WEBHOOK_URL: z.string(),
    METRIX_URL: z.string(),
    OPENROUTESERVICE_API_KEY: z.string(),
    OFFICIAL_URL: z.string(),
    RATING_URL: z.string(),
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
    STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS: z.string().min(1).optional(),
    UMAMI_SEND_URL: z.url().optional(),
    UMAMI_WEBSITE_ID: z.uuid().optional(),
    UMAMI_HOSTNAME: z.string().min(1).optional(),
    TOURNAMENTS_API_SECRET: z.string(),
    TOURNAMENTS_API_TOKEN: z.string(),
    ALLOWED_ORIGIN_SUFFIX: z.string().optional(),
    OPENROUTESERVICE_API_URL: z.string().optional(),
    BAHN_STATION_API_URL: z.string().optional(),
    PORT: z.string().optional(),
    NEW_PRODUCT_DAYS: z.string().optional(),
    REDIS_URL: z.string().optional(),
    DATABASE_URL: z.url().optional(),
    SESSION_SECRET: z.string().min(32).optional(),
    TRAINING_SIGNUP_PASSWORD: z.string().min(1).optional(),
  })
  .superRefine((config, context) => {
    const tracking = [
      config.UMAMI_SEND_URL,
      config.UMAMI_WEBSITE_ID,
      config.UMAMI_HOSTNAME,
      config.STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS,
    ];
    if (tracking.some(Boolean) && (!tracking.every(Boolean) || !config.DATABASE_URL)) {
      context.addIssue({
        code: 'custom',
        message:
          'Membership analytics requires all UMAMI fields, STRIPE_MEMBERSHIP_PAYMENT_LINK_IDS and DATABASE_URL',
      });
    }
  });

export type EnvSchema = z.infer<typeof EnvSchema>;

tryParseEnv(EnvSchema);

export default EnvSchema.parse(process.env);
