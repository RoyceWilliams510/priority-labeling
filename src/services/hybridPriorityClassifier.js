const logger = require('../utils/logger');
const config = require('../config/config');
const rulesClassifier = require('./priorityClassifier');
const aiClassifier = require('./aiPriorityClassifier');

/**
 * Hybrid Priority Classifier
 * 
 * Intelligently chooses between rule-based and AI-based classification
 * based on configuration, availability, and context.
 */
class HybridPriorityClassifier {
  constructor() {
    this.classifierType = config.aiClassifierType || 'ai'; // Default to AI classifier
    this.fallbackToRules = true; // Always enable fallback to rules for reliability
  }

  /**
   * Determine which classifier to use for this thread
   * @param {Object} thread - Thread data from Plain
   * @returns {string} 'ai', 'rules', or 'hybrid'
   */
  determineClassifierStrategy(thread) {
    // If explicitly configured to use AI (default behavior)
    if (this.classifierType === 'ai') {
      if (aiClassifier.isAvailable()) {
        logger.debug('Using AI classifier (default configuration)', {
          threadId: thread.id
        });
        return 'ai';
      } else {
        logger.warn('AI classifier configured but not available, falling back to rules', {
          threadId: thread.id,
          hasApiKey: !!config.claudeApiKey || !!config.openaiApiKey
        });
        return 'rules';
      }
    }
    
    // If explicitly configured to use rules only
    if (this.classifierType === 'rules') {
      logger.debug('Using rules classifier (explicit configuration)', {
        threadId: thread.id
      });
      return 'rules';
    }

    // Hybrid logic - intelligent choice based on context
    if (!aiClassifier.isAvailable()) {
      logger.debug('AI classifier not available, using rules', {
        threadId: thread.id
      });
      return 'rules';
    }

    // For hybrid mode: Use AI for complex cases, rules for simple ones
    const message = thread.firstMessage?.textContent || thread.firstMessage?.content || '';
    
    // Simple cases that rules handle well (and faster)
    const simpleIndicators = [
      message.length < 50, // Very short messages
      /^(hi|hello|hey|thanks)/i.test(message), // Greetings
      /\?(.*\?)/.test(message) && message.length < 100 // Simple questions
    ];

    if (simpleIndicators.some(indicator => indicator)) {
      logger.debug('Using rules classifier for simple case (hybrid mode)', {
        threadId: thread.id,
        messageLength: message.length
      });
      return 'rules';
    }

    // Default to AI for complex cases in hybrid mode
    logger.debug('Using AI classifier for complex case (hybrid mode)', {
      threadId: thread.id,
      messageLength: message.length
    });
    return 'ai';
  }

  /**
   * Main classification method
   * @param {Object} thread - Thread data from Plain
   * @returns {Promise<Object>} Classification result
   */
  async classifyThread(thread) {
    const startTime = Date.now();
    
    try {
      logger.info('Starting hybrid priority classification', {
        threadId: thread.id,
        configuredType: this.classifierType
      });

      const strategy = this.determineClassifierStrategy(thread);
      let result;
      let fallbackUsed = false;

      try {
        if (strategy === 'ai') {
          result = await aiClassifier.classifyThread(thread);
        } else {
          result = await rulesClassifier.classifyThread(thread);
        }
      } catch (error) {
        logger.warn('Primary classifier failed, attempting fallback', {
          threadId: thread.id,
          primaryStrategy: strategy,
          error: error.message
        });

        fallbackUsed = true;

        // Try fallback classifier
        if (strategy === 'ai' && this.fallbackToRules) {
          result = await rulesClassifier.classifyThread(thread);
          result.method = 'rules-fallback';
        } else if (strategy === 'rules') {
          // If rules fail, try AI if available
          if (aiClassifier.isAvailable()) {
            result = await aiClassifier.classifyThread(thread);
            result.method = 'ai-fallback';
          } else {
            throw error; // Re-throw if no fallback available
          }
        } else {
          throw error; // Re-throw if no fallback strategy
        }
      }

      const duration = Date.now() - startTime;

      // Enhance result with hybrid metadata
      const enhancedResult = {
        ...result,
        hybridStrategy: strategy,
        fallbackUsed,
        totalProcessingTime: duration,
        classifier: 'hybrid'
      };

      logger.info('Hybrid classification completed', {
        threadId: thread.id,
        strategy,
        fallbackUsed,
        priorityBand: result.priorityBand,
        priorityScore: result.priorityScore,
        duration
      });

      return enhancedResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Hybrid classification failed completely', {
        threadId: thread.id,
        error: error.message,
        duration
      });

      // Last resort: return default classification
      return {
        priorityScore: 500,
        priorityBand: 'P2',
        reasoning: `Classification failed: ${error.message}`,
        confidence: 'none',
        method: 'error-fallback',
        classifier: 'hybrid',
        error: error.message,
        totalProcessingTime: duration
      };
    }
  }

  /**
   * Compare AI vs Rules classification for analysis
   * @param {Object} thread - Thread data from Plain
   * @returns {Promise<Object>} Comparison results
   */
  async compareClassifiers(thread) {
    if (!aiClassifier.isAvailable()) {
      logger.warn('Cannot compare classifiers - AI not available');
      return null;
    }

    const startTime = Date.now();

    try {
      logger.info('Running classifier comparison', {
        threadId: thread.id
      });

      // Run both classifiers in parallel
      const [aiResult, rulesResult] = await Promise.allSettled([
        aiClassifier.classifyThread(thread),
        rulesClassifier.classifyThread(thread)
      ]);

      const comparison = {
        threadId: thread.id,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        ai: aiResult.status === 'fulfilled' ? aiResult.value : { error: aiResult.reason?.message },
        rules: rulesResult.status === 'fulfilled' ? rulesResult.value : { error: rulesResult.reason?.message },
        agreement: null,
        scoreDifference: null,
        bandAgreement: null
      };

      // Calculate agreement metrics
      if (aiResult.status === 'fulfilled' && rulesResult.status === 'fulfilled') {
        const aiScore = aiResult.value.priorityScore;
        const rulesScore = rulesResult.value.priorityScore;
        const aiBand = aiResult.value.priorityBand;
        const rulesBand = rulesResult.value.priorityBand;

        comparison.scoreDifference = Math.abs(aiScore - rulesScore);
        comparison.bandAgreement = aiBand === rulesBand;
        comparison.agreement = comparison.bandAgreement && comparison.scoreDifference <= 100;
      }

      logger.info('Classifier comparison completed', {
        threadId: thread.id,
        agreement: comparison.agreement,
        scoreDifference: comparison.scoreDifference,
        bandAgreement: comparison.bandAgreement
      });

      return comparison;

    } catch (error) {
      logger.error('Classifier comparison failed', {
        threadId: thread.id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get classification statistics and performance metrics
   * @returns {Promise<Object>} Performance statistics
   */
  async getPerformanceStats() {
    try {
      const [aiStats, dbStats] = await Promise.allSettled([
        aiClassifier.getClassificationStats(),
        // Could add timing stats, accuracy metrics, etc.
      ]);

      return {
        ai: aiStats.status === 'fulfilled' ? aiStats.value : null,
        database: dbStats.status === 'fulfilled' ? dbStats.value : null,
        config: {
          classifierType: this.classifierType,
          aiAvailable: aiClassifier.isAvailable(),
          fallbackEnabled: this.fallbackToRules
        }
      };
    } catch (error) {
      logger.error('Failed to get performance stats', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Check system health and readiness
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      status: 'healthy',
      classifiers: {
        ai: {
          available: aiClassifier.isAvailable(),
          configured: !!config.claudeApiKey || !!config.openaiApiKey
        },
        rules: {
          available: true,
          configured: true
        }
      },
      configuration: {
        type: this.classifierType,
        fallbackEnabled: this.fallbackToRules
      }
    };
  }
}

// Export singleton instance
module.exports = new HybridPriorityClassifier();
