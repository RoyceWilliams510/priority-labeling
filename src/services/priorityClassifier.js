const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Priority Classification Service
 * 
 * This service implements the rules-based priority classification logic
 * with optional AI enhancement for ticket prioritization.
 */
class PriorityClassifier {
  constructor() {
    this.rules = config.priorityRules;
  }

  /**
   * Classify a thread's priority based on content and metadata
   * @param {Object} thread - The Plain thread object
   * @returns {Object} Classification result with priority level and confidence
   */
  async classifyThread(thread) {
    logger.debug('Starting thread classification', {
      threadId: thread.id,
      customerId: thread.customer?.id
    });

    try {
      // Extract thread content and metadata
      const threadData = this.extractThreadData(thread);
      
      // Run rules-based classification
      const rulesResult = this.classifyByRules(threadData);
      
      // Optional: Enhance with AI classification
      let aiResult = null;
      if (config.openaiApiKey && rulesResult.confidence < 0.8) {
        aiResult = await this.classifyByAI(threadData);
      }
      
      // Combine results
      const finalResult = this.combineClassifications(rulesResult, aiResult);
      
      logger.info('Thread classification completed', {
        threadId: thread.id,
        priority: finalResult.priority,
        confidence: finalResult.confidence,
        method: finalResult.method,
        rulesScore: rulesResult.confidence,
        aiScore: aiResult?.confidence || null
      });

      return finalResult;

    } catch (error) {
      logger.error('Error during thread classification', {
        threadId: thread.id,
        error: error.message,
        stack: error.stack
      });

      // Return default classification on error
      return {
        priority: 'P2',
        confidence: 0.1,
        method: 'fallback',
        error: error.message
      };
    }
  }

  /**
   * Extract relevant data from thread for classification
   * @param {Object} thread - The Plain thread object
   * @returns {Object} Extracted thread data
   */
  extractThreadData(thread) {
    // Extract text content from thread messages
    let textContent = '';
    
    // Use all message content if available (from enhanced API call)
    if (thread.allMessageContent) {
      textContent = thread.allMessageContent;
      logger.debug('Using all message content for classification', {
        threadId: thread.id,
        contentLength: textContent.length,
        contentPreview: textContent.substring(0, 200)
      });
    } else if (thread.firstMessage) {
      textContent = this.extractTextFromMessage(thread.firstMessage);
      logger.debug('Using first message only for classification', {
        threadId: thread.id,
        contentLength: textContent.length
      });
    }
    
    // Also include thread title if available and not default
    if (thread.title && thread.title !== 'No preview' && thread.title !== thread.previewText) {
      textContent = (textContent + ' ' + thread.title).trim();
    }

    // Extract customer metadata
    const customer = thread.customer || {};
    const customerTier = this.determineCustomerTier(customer, thread);

    // Calculate timing metrics
    const createdAt = new Date(thread.createdAt?.iso8601 || Date.now());
    const hoursSinceCreated = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

    return {
      threadId: thread.id,
      title: thread.title || '',
      content: textContent.toLowerCase(),
      customer: {
        id: customer.id,
        email: customer.email,
        tier: customerTier,
        fullName: customer.fullName
      },
      timing: {
        createdAt,
        hoursSinceCreated
      },
      metadata: {
        hasAttachments: false, // TODO: Check for attachments
        isFollowUp: thread.isFollowUp || false,
        priority: thread.priority // Current priority if any
      }
    };
  }

  /**
   * Extract text content from a Plain message object
   * @param {Object} message - The Plain message object
   * @returns {string} Extracted text content
   */
  extractTextFromMessage(message) {
    if (!message.content) return '';
    
    // Handle different content types
    let text = '';
    if (Array.isArray(message.content)) {
      for (const component of message.content) {
        if (component.text) {
          text += component.text + ' ';
        }
        // Handle other component types as needed
      }
    } else if (typeof message.content === 'string') {
      text = message.content;
    }

    return text.trim();
  }

  /**
   * Determine customer tier based on thread tier data
   * @param {Object} customer - Customer object
   * @param {Object} thread - Thread object containing tier information
   * @returns {string} Customer tier
   */
  determineCustomerTier(customer, thread) {
    // Use thread.tier.name if available (simplest approach)
    if (thread?.tier?.name) {
      const tierName = thread.tier.name.toLowerCase();
      
      logger.debug('Using thread tier for customer classification', {
        customerId: customer?.id,
        threadId: thread?.id,
        tierName: thread.tier.name,
        email: customer?.email?.email || customer?.email
      });

      // Map Plain tier names to our internal tier system
      // if (tierName.includes('enterprise') || tierName.includes('premium')) {
      //   return 'enterprise';
      // }
      // if (tierName.includes('pro') || tierName.includes('professional')) {
      //   return 'pro';
      // }
      // if (tierName.includes('hobby') || tierName.includes('personal')) {
      //   return 'hobby';
      // }
      // if (tierName.includes('trial') || tierName.includes('free')) {
      //   return 'trialing';
      // }
      // Return the tier name as-is if it doesn't match our patterns
      return tierName;
    }

    // Fallback to default if no tier information
    logger.debug('No thread tier available, using default', {
      customerId: customer?.id,
      threadId: thread?.id
    });
    
    return 'hobby';
  }

  /**
   * Classify thread priority using rules-based approach
   * @param {Object} threadData - Extracted thread data
   * @returns {Object} Classification result
   */
  classifyByRules(threadData) {
    const scores = {
      P0: 0,
      P1: 0,
      P2: 0,
      P3: 0
    };

    const content = threadData.content;
    const customerTier = threadData.customer.tier;

    // Evaluate each priority level
    for (const [priority, rules] of Object.entries(this.rules)) {
      let score = 0;
      let matches = [];

      // Keyword matching
      const keywordMatches = rules.keywords.filter(keyword => 
        content.includes(keyword.toLowerCase())
      );
      
      if (keywordMatches.length > 0) {
        score += 0.5 + (keywordMatches.length * 0.1);
        matches.push(`keywords: ${keywordMatches.join(', ')}`);
      }

      // Customer tier matching
      if (rules.customerTiers.includes(customerTier)) {
        score += 0.3;
        matches.push(`customer tier: ${customerTier}`);
      }

      // Time-based scoring (higher priority for older tickets without response)
      const hoursOld = threadData.timing.hoursSinceCreated;
      const responseThresholdHours = rules.timeThresholds.response / (60 * 60);
      
      if (hoursOld > responseThresholdHours) {
        score += 0.2;
        matches.push(`overdue: ${hoursOld.toFixed(1)}h > ${responseThresholdHours}h`);
      }

      scores[priority] = Math.min(score, 1.0); // Cap at 1.0

      if (matches.length > 0) {
        logger.debug(`Rules evaluation for ${priority}`, {
          threadId: threadData.threadId,
          priority,
          score: scores[priority],
          matches
        });
      }
    }

    // Find the highest scoring priority
    const maxScore = Math.max(...Object.values(scores));
    const winningPriority = Object.keys(scores).find(p => scores[p] === maxScore);

    return {
      priority: winningPriority || 'P2',
      confidence: maxScore,
      method: 'rules',
      scores,
      details: {
        contentLength: threadData.content.length,
        customerTier: threadData.customer.tier,
        hoursOld: threadData.timing.hoursSinceCreated
      }
    };
  }

  /**
   * Classify thread priority using AI (optional enhancement)
   * @param {Object} threadData - Extracted thread data
   * @returns {Object} AI classification result
   */
  async classifyByAI(threadData) {
    if (!config.openaiApiKey) {
      return null;
    }

    try {
      // TODO: Implement AI classification using OpenAI API
      // This would involve sending the thread content to an AI model
      // and getting back a priority classification
      
      logger.debug('AI classification not yet implemented', {
        threadId: threadData.threadId
      });

      return {
        priority: 'P2',
        confidence: 0.5,
        method: 'ai',
        model: config.aiModel
      };

    } catch (error) {
      logger.error('Error in AI classification', {
        threadId: threadData.threadId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Combine rules-based and AI classification results
   * @param {Object} rulesResult - Rules classification result
   * @param {Object} aiResult - AI classification result (optional)
   * @returns {Object} Combined classification result
   */
  combineClassifications(rulesResult, aiResult) {
    if (!aiResult) {
      return {
        priority: rulesResult.priority,
        confidence: rulesResult.confidence,
        method: rulesResult.method,
        rulesResult,
        aiResult: null
      };
    }

    // Weight the results (favor rules-based for now)
    const rulesWeight = 0.7;
    const aiWeight = 0.3;

    const combinedConfidence = (
      rulesResult.confidence * rulesWeight + 
      aiResult.confidence * aiWeight
    );

    // Choose priority based on higher confidence
    const finalPriority = rulesResult.confidence >= aiResult.confidence 
      ? rulesResult.priority 
      : aiResult.priority;

    return {
      priority: finalPriority,
      confidence: combinedConfidence,
      method: 'combined',
      rulesResult,
      aiResult
    };
  }

  /**
   * Get priority level from label type ID
   * @param {string} labelTypeId - Plain label type ID
   * @returns {string|null} Priority level (P0, P1, P2, P3) or null
   */
  getPriorityFromLabelId(labelTypeId) {
    for (const [priority, id] of Object.entries(config.priorityLabels)) {
      if (id === labelTypeId) {
        return priority;
      }
    }
    return null;
  }

  /**
   * Get label type ID for a priority level
   * @param {string} priority - Priority level (P0, P1, P2, P3)
   * @returns {string|null} Label type ID or null
   */
  getLabelIdForPriority(priority) {
    return config.priorityLabels[priority] || null;
  }
}

module.exports = new PriorityClassifier();
