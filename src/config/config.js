const config = {
  // Server configuration
  port: parseInt(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Plain API configuration
  plainApiToken: process.env.PLAIN_API_TOKEN,
  plainSignatureSecret: process.env.PLAIN_SIGNATURE_SECRET,
  plainWorkspaceId: process.env.PLAIN_WORKSPACE_ID,
  plainApiUrl: 'https://core-api.uk.plain.com/graphql/v1',
  
  // Webhook configuration
  webhookEndpointPath: process.env.WEBHOOK_ENDPOINT_PATH || '/webhook/plain',
  
  // Priority label configuration
  priorityLabels: {
    P0: process.env.LABEL_P0_ID,
    P1: process.env.LABEL_P1_ID,
    P2: process.env.LABEL_P2_ID,
    P3: process.env.LABEL_P3_ID
  },
  
  // AI/ML configuration
  openaiApiKey: process.env.OPENAI_API_KEY,
  aiModel: process.env.AI_MODEL || 'gpt-4',
  aiTemperature: parseFloat(process.env.AI_TEMPERATURE) || 0.1,
  
  // Logging configuration
  logLevel: process.env.LOG_LEVEL || 'info',
  logFormat: process.env.LOG_FORMAT || 'combined',
  
  // Security configuration
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  
  // Database configuration - Supabase
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  
  // Monitoring configuration (optional)
  sentryDsn: process.env.SENTRY_DSN,
  newRelicLicenseKey: process.env.NEW_RELIC_LICENSE_KEY,
  
  // Priority classification rules
  priorityRules: {
    // P0 - Critical/Emergency (immediate response required)
    P0: {
      keywords: [
        'down', 'outage', 'critical', 'emergency', 'urgent', 'broken', 'crash',
        'security breach', 'data loss', 'payment failed', 'cannot login',
        'site down', 'server error', 'production issue'
      ],
      customerTiers: ['custom', 'pro','hobby'],
      timeThresholds: {
        created: 0, // Immediate
        response: 60 * 15 // 15 minutes
      },
      escalationRules: {
        autoAssign: false,
        notifyManagement: false
      }
    },
    
    // P1 - High (same day response)
    P1: {
      keywords: [
        'bug', 'error', 'issue', 'problem', 'not working', 'feature request',
        'integration', 'api', 'billing', 'account', 'performance'
      ],
      customerTiers: ['custom', 'pro','hobby','trial'],
      timeThresholds: {
        created: 60 * 60 * 4, // 4 hours
        response: 60 * 60 * 8 // 8 hours
      },
      escalationRules: {
        autoAssign: false,
        notifyManagement: false
      }
    },
    
    // P2 - Medium (next business day response)
    P2: {
      keywords: [
        'question', 'help', 'how to', 'clarification', 'documentation',
        'training', 'onboarding', 'best practice', 'recommendation'
      ],
      customerTiers: ['custom', 'pro','hobby','trial'],
      timeThresholds: {
        created: 60 * 60 * 24, // 24 hours
        response: 60 * 60 * 24 // 24 hours
      },
      escalationRules: {
        autoAssign: false,
        notifyManagement: false
      }
    },
    
    // P3 - Low (up to 3 business days response)
    P3: {
      keywords: [
        'feedback', 'suggestion', 'enhancement', 'nice to have',
        'cosmetic', 'minor', 'improvement', 'general inquiry'
      ],
      customerTiers: ['custom', 'pro','hobby','trial'],
      timeThresholds: {
        created: 60 * 60 * 72, // 72 hours
        response: 60 * 60 * 72 // 72 hours
      },
      escalationRules: {
        autoAssign: false,
        notifyManagement: false
      }
    }
  }
};

// Validation
const requiredEnvVars = [
  'PLAIN_API_TOKEN',
  'PLAIN_SIGNATURE_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

module.exports = config;
