const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');
const database = require('./database');

/**
 * AI-Powered Priority Classifier using Claude with Historical Context
 * 
 * This classifier uses a sliding window approach to provide Claude with
 * recent ticket classifications for better context-aware prioritization.
 */
class AIPriorityClassifier {
  constructor() {
    this.apiKey = config.claudeApiKey || config.openaiApiKey; // Use Claude API key, fallback to OpenAI
    this.model = config.aiModel || 'claude-3-5-sonnet-20241022'; // Latest Claude model
    this.apiUrl = 'https://api.anthropic.com/v1/messages';
    this.slidingWindowSize = 12; // Number of recent tickets for context
    
    // Create axios instance for Claude API
    this.client = axios.create({
      baseURL: 'https://api.anthropic.com/v1',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      timeout: 30000 // 30 second timeout for AI calls
    });

    // Add request/response interceptors for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Claude API request', {
          method: config.method,
          url: config.url,
          hasKey: !!config.headers['x-api-key']
        });
        return config;
      },
      (error) => {
        logger.error('Claude API request error', { error: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Claude API response', {
          status: response.status,
          usage: response.data.usage
        });
        return response;
      },
      (error) => {
        logger.error('Claude API response error', {
          status: error.response?.status,
          message: error.message,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get recent tickets for historical context
   * @param {number} limit - Number of recent tickets to fetch
   * @returns {Promise<Array>} Array of recent ticket classifications
   */
  async getHistoricalContext(limit = this.slidingWindowSize) {
    try {
      const recentTickets = await database.getRecentTickets(limit);
      
      if (!recentTickets || recentTickets.length === 0) {
        logger.debug('No historical tickets found for context');
        return [];
      }

      // Format tickets for prompt context
      const formattedTickets = recentTickets.map((ticket, index) => {
        return {
          example_number: index + 1,
          first_message: this.truncateMessage(ticket.first_message || ''),
          priority_score: ticket.priority_score,
          priority_band: ticket.priority_band,
          reasoning: ticket.reasoning || 'No reasoning provided',
          processed_at: ticket.processed_at
        };
      });

      logger.debug('Retrieved historical context', {
        ticketCount: formattedTickets.length,
        dateRange: {
          oldest: recentTickets[recentTickets.length - 1]?.processed_at,
          newest: recentTickets[0]?.processed_at
        }
      });

      return formattedTickets;
    } catch (error) {
      logger.error('Failed to get historical context', {
        error: error.message,
        limit
      });
      return []; // Return empty array if database fails
    }
  }

  /**
   * Truncate message to prevent prompt bloat
   * @param {string} message - Original message
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated message
   */
  truncateMessage(message, maxLength = 200) {
    if (!message || message.length <= maxLength) {
      return message;
    }
    return message.substring(0, maxLength) + '...';
  }

  /**
   * Build enhanced prompt with historical context
   * @param {string} firstMessage - The ticket message to classify
   * @param {Array} historicalContext - Recent ticket examples
   * @returns {string} Complete prompt for Claude
   */
  buildPromptWithContext(firstMessage, historicalContext) {
    const basePrompt = `You are an expert customer support triage analyst. When given the first message of a support ticket, assign an integer priority_score from 0 to 1000, a priority_band (P0, P1, P2, P3) based on these rules:

- P0: Critical outage, company-wide or many users blocked (score: 0–150)
- P1: Major issue, multiple users impacted but workaround may exist (151–400)
- P2: Moderate, minor feature broken or single user (401–700)
- P3: Low, no operational impact, general question, or feature request (701–1000)

For each ticket, output:
- priority_score: number
- priority_band: string (P0–P3)
- reasoning: short explanation for your decision`;

    let contextSection = '';
    if (historicalContext && historicalContext.length > 0) {
      contextSection = `\n\nHere are recent ticket classifications from this system for context and consistency:\n\n`;
      
      historicalContext.forEach((ticket) => {
        contextSection += `Example ${ticket.example_number}:
Ticket: "${ticket.first_message}"
priority_score: ${ticket.priority_score}
priority_band: ${ticket.priority_band}
reasoning: ${ticket.reasoning}

`;
      });

      contextSection += `Please maintain consistency with these recent classifications while applying the priority rules.\n`;
    }

    const staticExamples = `\nHere are some reference examples:

Ticket: "The entire payments system is down for all customers."
priority_score: 25
priority_band: P0
reasoning: Full outage of payments impacts all users; requires immediate attention.

Ticket: "My reports page failed to load this morning, but worked later."
priority_score: 575
priority_band: P2
reasoning: Intermittent minor failure, affected one user, now resolved.`;

    const evaluationSection = `\n---
Now evaluate this ticket:
Ticket: "${firstMessage}"

Please provide your response in this exact format:
priority_score: [number]
priority_band: [P0/P1/P2/P3]
reasoning: [short explanation]`;

    return basePrompt + contextSection + staticExamples + evaluationSection;
  }

  /**
   * Call Claude API to classify ticket priority
   * @param {string} prompt - Complete prompt with context
   * @returns {Promise<Object>} Claude's response
   */
  async callClaudeAPI(prompt) {
    const requestBody = {
      model: this.model,
      max_tokens: 300,
      temperature: 0.1, // Low temperature for consistent classification
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    };

    try {
      const response = await this.client.post('/messages', requestBody);
      
      logger.debug('Claude classification completed', {
        model: this.model,
        usage: response.data.usage,
        promptLength: prompt.length
      });

      return response.data.content[0].text;
    } catch (error) {
      logger.error('Claude API call failed', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw error;
    }
  }

  /**
   * Parse Claude's response to extract classification data
   * @param {string} claudeResponse - Raw response from Claude
   * @returns {Object} Parsed classification
   */
  parseClaudeResponse(claudeResponse) {
    try {
      const lines = claudeResponse.split('\n').filter(line => line.trim());
      const result = {};

      for (const line of lines) {
        if (line.includes('priority_score:')) {
          const score = parseInt(line.split(':')[1].trim());
          if (!isNaN(score) && score >= 0 && score <= 1000) {
            result.priorityScore = score;
          }
        } else if (line.includes('priority_band:')) {
          const band = line.split(':')[1].trim();
          if (['P0', 'P1', 'P2', 'P3'].includes(band)) {
            result.priorityBand = band;
          }
        } else if (line.includes('reasoning:')) {
          result.reasoning = line.split(':').slice(1).join(':').trim();
        }
      }

      // Validate required fields
      if (!result.priorityScore || !result.priorityBand) {
        throw new Error('Missing required fields in Claude response');
      }

      // Validate score matches band
      const expectedBands = {
        P0: [0, 150],
        P1: [151, 400],
        P2: [401, 700],
        P3: [701, 1000]
      };

      const [min, max] = expectedBands[result.priorityBand];
      if (result.priorityScore < min || result.priorityScore > max) {
        logger.warn('Priority score does not match band, adjusting', {
          originalScore: result.priorityScore,
          band: result.priorityBand,
          expectedRange: [min, max]
        });
        
        // Adjust score to match band
        result.priorityScore = Math.max(min, Math.min(max, result.priorityScore));
      }

      return result;
    } catch (error) {
      logger.error('Failed to parse Claude response', {
        error: error.message,
        response: claudeResponse
      });
      throw new Error(`Unable to parse Claude response: ${error.message}`);
    }
  }

  /**
   * Main classification method
   * @param {Object} thread - Thread data from Plain
   * @returns {Promise<Object>} Classification result
   */
  async classifyThread(thread) {
    const startTime = Date.now();
    
    try {
      logger.info('Starting AI priority classification', {
        threadId: thread.id,
        hasFirstMessage: !!thread.firstMessage
      });

      // Validate input
      if (!thread.firstMessage?.textContent && !thread.firstMessage?.content) {
        throw new Error('No message content available for classification');
      }

      const firstMessage = thread.firstMessage.textContent || thread.firstMessage.content;
      
      // Get historical context (sliding window)
      const historicalContext = await this.getHistoricalContext();
      
      // Build prompt with context
      const prompt = this.buildPromptWithContext(firstMessage, historicalContext);
      
      logger.debug('Built classification prompt', {
        promptLength: prompt.length,
        historicalExamples: historicalContext.length,
        threadId: thread.id
      });

      // Call Claude API
      const claudeResponse = await this.callClaudeAPI(prompt);
      
      // Parse response
      const classification = this.parseClaudeResponse(claudeResponse);
      
      const duration = Date.now() - startTime;
      
      logger.info('AI classification completed', {
        threadId: thread.id,
        priorityScore: classification.priorityScore,
        priorityBand: classification.priorityBand,
        duration,
        historicalContextUsed: historicalContext.length
      });

      return {
        priorityScore: classification.priorityScore,
        priorityBand: classification.priorityBand,
        reasoning: classification.reasoning || 'AI-powered classification',
        confidence: 'high', // Could be enhanced with confidence scoring
        method: 'ai-claude',
        historicalContextUsed: historicalContext.length,
        modelUsed: this.model,
        processingTime: duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('AI classification failed', {
        threadId: thread.id,
        error: error.message,
        duration
      });

      // Return fallback classification
      return this.getFallbackClassification(thread, error);
    }
  }

  /**
   * Provide fallback classification when AI fails
   * @param {Object} thread - Thread data
   * @param {Error} error - Original error
   * @returns {Object} Fallback classification
   */
  getFallbackClassification(thread, error) {
    logger.warn('Using fallback classification due to AI failure', {
      threadId: thread.id,
      error: error.message
    });

    // Simple keyword-based fallback
    const message = (thread.firstMessage?.textContent || thread.firstMessage?.content || '').toLowerCase();
    
    const criticalKeywords = ['down', 'outage', 'critical', 'emergency', 'broken', 'crash'];
    const highKeywords = ['bug', 'error', 'issue', 'problem', 'not working', 'failed'];
    const lowKeywords = ['question', 'help', 'how to', 'feature request', 'suggestion'];

    let priorityScore = 500; // Default medium priority
    let priorityBand = 'P2';
    let reasoning = 'Fallback classification due to AI unavailability';

    if (criticalKeywords.some(keyword => message.includes(keyword))) {
      priorityScore = 100;
      priorityBand = 'P0';
      reasoning = 'Contains critical keywords, classified as high priority';
    } else if (highKeywords.some(keyword => message.includes(keyword))) {
      priorityScore = 300;
      priorityBand = 'P1';
      reasoning = 'Contains issue keywords, classified as medium-high priority';
    } else if (lowKeywords.some(keyword => message.includes(keyword))) {
      priorityScore = 800;
      priorityBand = 'P3';
      reasoning = 'Contains general inquiry keywords, classified as low priority';
    }

    return {
      priorityScore,
      priorityBand,
      reasoning,
      confidence: 'low',
      method: 'fallback-keywords',
      error: error.message
    };
  }

  /**
   * Check if AI classification is available
   * @returns {boolean} True if API key is configured
   */
  isAvailable() {
    return !!this.apiKey;
  }

  /**
   * Get statistics about recent classifications
   * @returns {Promise<Object>} Classification statistics
   */
  async getClassificationStats() {
    try {
      const stats = await database.getPriorityStats(7); // Last 7 days
      return {
        totalClassifications: stats?.reduce((sum, stat) => sum + parseInt(stat.count), 0) || 0,
        priorityDistribution: stats || [],
        averageScoreByBand: stats?.reduce((acc, stat) => {
          acc[stat.priority_band] = parseFloat(stat.avg_score);
          return acc;
        }, {}) || {}
      };
    } catch (error) {
      logger.error('Failed to get classification stats', {
        error: error.message
      });
      return null;
    }
  }
}

// Export singleton instance
module.exports = new AIPriorityClassifier();
