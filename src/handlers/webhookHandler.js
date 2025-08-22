import {
  PlainWebhookSignatureVerificationError,
  PlainWebhookVersionMismatchError,
  verifyPlainWebhook
} from '@team-plain/typescript-sdk';

const logger = require('../utils/logger');
const config = require('../config/config');
const priorityClassifier = require('../services/hybridPriorityClassifier'); // Use AI-powered hybrid classifier
const plainApiClient = require('../services/plainApiClient');

/**
 * Main webhook handler for Plain events
 */
async function handlePlainWebhook(req, res) {
  const startTime = Date.now();
  const requestId = generateRequestId();
  
  logger.info('Received Plain webhook', {
    requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    contentLength: req.get('Content-Length')
  });

  try {
    // Get the raw payload and signature
    const payload = req.body;
    const signature = req.get('Plain-Request-Signature');
    const workspaceId = req.get('Plain-Workspace-Id');

    if (!signature) {
      logger.warn('Missing Plain-Request-Signature header', { requestId });
      return res.status(401).json({ error: 'Missing signature header' });
    }

    // Verify the webhook signature
    const webhookResult = verifyPlainWebhook(
      payload,
      signature,
      config.plainSignatureSecret
    );

    if (webhookResult.error instanceof PlainWebhookSignatureVerificationError) {
      logger.warn('Failed to verify webhook signature', { 
        requestId,
        error: webhookResult.error.message 
      });
      return res.status(401).json({ error: 'Failed to verify webhook signature' });
    }

    if (webhookResult.error instanceof PlainWebhookVersionMismatchError) {
      logger.warn('Webhook version mismatch', { 
        requestId,
        error: webhookResult.error.message 
      });
      return res.status(400).json({ error: 'Webhook version mismatch' });
    }

    if (webhookResult.error) {
      logger.error('Unexpected webhook verification error', { 
        requestId,
        error: webhookResult.error.message 
      });
      return res.status(500).json({ error: 'Unexpected error' });
    }

    // Parse the webhook data
    const webhookData = webhookResult.data;
    const eventType = webhookData.payload.eventType;

    logger.info('Webhook verified successfully', {
      requestId,
      eventType,
      workspaceId
    });

    // Process based on event type
    switch (eventType) {
      case 'thread.thread_created':
        await handleThreadCreated(webhookData.payload, requestId);
        break;
      
      case 'thread.email_received':
        await handleEmailReceived(webhookData.payload, requestId);
        break;
      
      case 'thread.labels_changed':
        await handleLabelsChanged(webhookData.payload, requestId);
        break;
      
      default:
        logger.debug('Unhandled event type', { requestId, eventType });
        break;
    }

    // Send success response
    const processingTime = Date.now() - startTime;
    logger.info('Webhook processed successfully', {
      requestId,
      eventType,
      processingTimeMs: processingTime
    });

    res.status(200).json({ 
      success: true, 
      message: 'Webhook processed successfully',
      requestId,
      processingTimeMs: processingTime
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('Error processing webhook', {
      requestId,
      error: error.message,
      stack: error.stack,
      processingTimeMs: processingTime
    });

    res.status(500).json({ 
      error: 'Internal server error',
      requestId 
    });
  }
}

/**
 * Handle thread created events
 */
async function handleThreadCreated(payload, requestId) {
  const thread = payload.thread;
  
  logger.info('Processing thread created event', {
    requestId,
    threadId: thread.id,
    customerId: thread.customer?.id,
    customerEmail: thread.customer?.email
  });

  try {
    // Classify the thread priority using AI-powered classifier
    const classification = await priorityClassifier.classifyThread(thread);
    
    logger.info('Thread classified', {
      requestId,
      threadId: thread.id,
      priorityBand: classification.priorityBand,
      priorityScore: classification.priorityScore,
      confidence: classification.confidence,
      method: classification.method
    });

    // Apply the priority label if confidence is high enough
    const shouldApplyLabel = classification.confidence === 'high' || 
                           classification.confidence === 'medium' || 
                           (typeof classification.confidence === 'number' && classification.confidence >= 0.7);

    if (shouldApplyLabel) {
      await plainApiClient.addPriorityLabel(thread.id, classification.priorityBand);
      
      logger.info('Priority label applied', {
        requestId,
        threadId: thread.id,
        priorityBand: classification.priorityBand,
        priorityScore: classification.priorityScore,
        confidence: classification.confidence
      });
    } else {
      logger.info('Low confidence classification, manual review required', {
        requestId,
        threadId: thread.id,
        priorityBand: classification.priorityBand,
        priorityScore: classification.priorityScore,
        confidence: classification.confidence
      });
    }

  } catch (error) {
    logger.error('Error processing thread created event', {
      requestId,
      threadId: thread.id,
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Handle email received events
 */
async function handleEmailReceived(payload, requestId) {
  const thread = payload.thread;
  const isStartOfThread = payload.isStartOfThread;
  
  // Only process if this is the start of a new thread
  if (!isStartOfThread) {
    logger.debug('Email received but not start of thread, skipping', {
      requestId,
      threadId: thread.id
    });
    return;
  }
  
  logger.info('Processing email received event (start of thread)', {
    requestId,
    threadId: thread.id,
    customerId: thread.customer?.id,
    customerEmail: thread.customer?.email
  });

  // Reuse the same logic as thread created
  await handleThreadCreated(payload, requestId);
}

/**
 * Handle labels changed events (for feedback loop)
 */
async function handleLabelsChanged(payload, requestId) {
  const thread = payload.thread;
  const addedLabels = payload.addedLabels || [];
  const removedLabels = payload.removedLabels || [];
  
  logger.info('Processing labels changed event', {
    requestId,
    threadId: thread.id,
    addedLabels: addedLabels.map(l => l.labelType?.name),
    removedLabels: removedLabels.map(l => l.labelType?.name)
  });

  // Check if priority labels were manually changed
  const priorityLabelTypes = Object.values(config.priorityLabels);
  const manualPriorityChanges = [...addedLabels, ...removedLabels].filter(label => 
    priorityLabelTypes.includes(label.labelType?.id)
  );

  if (manualPriorityChanges.length > 0) {
    logger.info('Manual priority label changes detected', {
      requestId,
      threadId: thread.id,
      changes: manualPriorityChanges.map(l => ({
        action: addedLabels.includes(l) ? 'added' : 'removed',
        label: l.labelType?.name
      }))
    });

    // TODO: Implement feedback loop to improve classification
    // This could involve storing the manual override for training data
  }
}

/**
 * Generate a unique request ID for tracking
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = {
  handlePlainWebhook,
  handleThreadCreated,
  handleEmailReceived,
  handleLabelsChanged
};
