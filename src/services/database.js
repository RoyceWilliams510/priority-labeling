const { Pool } = require('pg');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Database service for Supabase PostgreSQL connection
 * Handles audit logging and data persistence
 */
class DatabaseService {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Initialize database connection
   */
  async initialize() {
    if (this.pool) {
      return this.pool;
    }

    if (!config.databaseUrl) {
      logger.warn('No database URL configured, skipping database connection');
      return null;
    }

    try {
      this.pool = new Pool({
        connectionString: config.databaseUrl,
        ssl: {
          rejectUnauthorized: false // Required for Supabase
        },
        max: 10, // Maximum connections in pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Test the connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isConnected = true;
      logger.info('Successfully connected to Supabase database', {
        database: 'supabase-postgres',
        ssl: true
      });

      // Create tables if they don't exist
      await this.createTables();

      return this.pool;
    } catch (error) {
      logger.error('Failed to connect to database', {
        error: error.message,
        stack: error.stack
      });
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Create necessary tables based on your table.sql design
   */
  async createTables() {
    if (!this.pool) return;

    const createTablesSQL = `
      -- Basic ticket storage table (based on your table.sql)
      CREATE TABLE IF NOT EXISTS tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        thread_id text NOT NULL UNIQUE,
        message_id text,
        first_message text NOT NULL,
        priority_score integer,
        priority_band text,
        reasoning text, -- for debugging LLM decisions
        processed_at timestamp with time zone,
        created_at timestamp with time zone DEFAULT now(),
        updated_at timestamp with time zone DEFAULT now()
      );

      -- Indexes for fast lookups
      CREATE INDEX IF NOT EXISTS idx_tickets_thread_id ON tickets(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_priority_band ON tickets(priority_band);
      CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);

      -- Enable Row Level Security (good practice)
      ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

      -- Policy to allow service role to do everything (for your API)
      DROP POLICY IF EXISTS "Service role can do everything" ON tickets;
      CREATE POLICY "Service role can do everything" ON tickets
      FOR ALL USING (true); -- Simplified for now, you can adjust based on your auth setup
    `;

    try {
      await this.pool.query(createTablesSQL);
      logger.info('Database tables created/verified successfully');
    } catch (error) {
      logger.error('Failed to create database tables', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Save or update a ticket classification
   */
  async saveTicket({
    threadId,
    messageId,
    firstMessage,
    priorityScore,
    priorityBand,
    reasoning
  }) {
    if (!this.isConnected || !this.pool) {
      logger.debug('Database not connected, skipping ticket save');
      return;
    }

    try {
      const query = `
        INSERT INTO tickets (
          thread_id, message_id, first_message, priority_score, priority_band, reasoning, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (thread_id) 
        DO UPDATE SET 
          priority_score = EXCLUDED.priority_score,
          priority_band = EXCLUDED.priority_band,
          reasoning = EXCLUDED.reasoning,
          processed_at = NOW(),
          updated_at = NOW()
        RETURNING id
      `;

      const values = [
        threadId,
        messageId,
        firstMessage,
        priorityScore,
        priorityBand,
        reasoning
      ];

      const result = await this.pool.query(query, values);
      
      logger.debug('Ticket saved to database', {
        ticketId: result.rows[0].id,
        threadId,
        priorityBand
      });

      return result.rows[0].id;
    } catch (error) {
      logger.error('Failed to save ticket to database', {
        error: error.message,
        threadId
      });
    }
  }

  /**
   * Get a ticket by thread ID
   */
  async getTicket(threadId) {
    if (!this.isConnected || !this.pool) {
      return null;
    }

    try {
      const query = `
        SELECT * FROM tickets 
        WHERE thread_id = $1
      `;

      const result = await this.pool.query(query, [threadId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to get ticket from database', {
        error: error.message,
        threadId
      });
      return null;
    }
  }

  /**
   * Get recent tickets with statistics
   */
  async getRecentTickets(limit = 50) {
    if (!this.isConnected || !this.pool) {
      return null;
    }

    try {
      const query = `
        SELECT 
          thread_id,
          priority_band,
          priority_score,
          reasoning,
          processed_at,
          created_at
        FROM tickets 
        ORDER BY created_at DESC
        LIMIT $1
      `;

      const result = await this.pool.query(query, [limit]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get recent tickets', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get priority band statistics
   */
  async getPriorityStats(days = 7) {
    if (!this.isConnected || !this.pool) {
      return null;
    }

    try {
      const query = `
        SELECT 
          priority_band,
          COUNT(*) as count,
          AVG(priority_score) as avg_score
        FROM tickets 
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY priority_band
        ORDER BY priority_band
      `;

      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get priority stats', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('Database connection closed');
    }
  }
}

// Export singleton instance
module.exports = new DatabaseService();
