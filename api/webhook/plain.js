// Try different import approaches for Plain SDK
let verifyPlainWebhook, PlainWebhookSignatureVerificationError, PlainWebhookVersionMismatchError;

try {
  // Method 1: Direct destructuring
  const sdk = require('@team-plain/typescript-sdk');
  verifyPlainWebhook = sdk.verifyPlainWebhook;
  PlainWebhookSignatureVerificationError = sdk.PlainWebhookSignatureVerificationError;
  PlainWebhookVersionMismatchError = sdk.PlainWebhookVersionMismatchError;
} catch (e1) {
  try {
    // Method 2: Default export
    const sdk = require('@team-plain/typescript-sdk').default;
    verifyPlainWebhook = sdk.verifyPlainWebhook;
    PlainWebhookSignatureVerificationError = sdk.PlainWebhookSignatureVerificationError;
    PlainWebhookVersionMismatchError = sdk.PlainWebhookVersionMismatchError;
  } catch (e2) {
    console.error('Failed to import Plain SDK:', e1, e2);
  }
}

// Import your services (you may need to adjust paths)
const logger = require('../../src/utils/logger');
const config = require('../../src/config/config');
const priorityClassifier = require('../../src/services/priorityClassifier');
const plainApiClient = require('../../src/services/plainApiClient');
const database = require('../../src/services/database');

// Fallback webhook verification
const { 
  verifyPlainWebhookManual,
  PlainWebhookSignatureVerificationError: ManualVerificationError,
  PlainWebhookVersionMismatchError: ManualVersionError
} = require('../../src/utils/webhookVerification');

// Configure body parser for raw text - this is important for webhook signature verification
export const config_vercel = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}

// Initialize database connection on first request
let dbInitialized = false;

/**
 * Serverless function for handling Plain webhooks
 */
module.exports = async (req, res) => {
  // Initialize database on first request
  if (!dbInitialized) {
    try {
      await database.initialize();
      dbInitialized = true;
    } catch (error) {
      logger.warn('Database initialization failed, continuing without database', {
        error: error.message
      });
    }
  }
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  const requestId = generateRequestId();
  
  try {
    // Log complete request details for debugging
    logger.info('Received Plain webhook (serverless) - FULL REQUEST LOG', {
      requestId,
      method: req.method,
      url: req.url,
      headers: req.headers,
      query: req.query,
      rawBody: req.body,
      bodyType: typeof req.body,
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent'],
      contentLength: req.headers['content-length'],
    });

    // Handle body parsing for signature verification
    let rawBody;
    let parsedBody;
    
    // Try to get raw body first
    if (req.body && typeof req.body === 'string') {
      rawBody = req.body;
      try {
        parsedBody = JSON.parse(req.body);
      } catch (e) {
        parsedBody = req.body;
      }
    } else if (req.body && typeof req.body === 'object') {
      // Body was already parsed by Vercel
      parsedBody = req.body;
      rawBody = JSON.stringify(req.body);
    } else {
      // Try to read raw body from request
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      await new Promise(resolve => req.on('end', resolve));
      rawBody = Buffer.concat(chunks).toString();
      try {
        parsedBody = JSON.parse(rawBody);
      } catch (e) {
        parsedBody = rawBody;
      }
    }
    
    const signature = req.headers['plain-request-signature'];
    const workspaceId = req.headers['plain-workspace-id'];

    // Log processed body details
    logger.info('Processed webhook body details', {
      requestId,
      rawBodyType: typeof rawBody,
      rawBodyLength: rawBody?.length,
      rawBodyPreview: rawBody ? rawBody.substring(0, 200) + '...' : 'null',
      parsedBodyType: typeof parsedBody,
      parsedBodyKeys: parsedBody && typeof parsedBody === 'object' ? Object.keys(parsedBody) : 'not-object',
      signature: signature ? signature.substring(0, 20) + '...' : 'missing',
      workspaceId
    });

    if (!signature) {
      logger.warn('Missing Plain-Request-Signature header', { requestId });
      return res.status(401).json({ error: 'Missing signature header' });
    }

    logger.debug('Webhook verification details', {
      requestId,
      hasRawBody: !!rawBody,
      rawBodyLength: rawBody?.length,
      hasSignature: !!signature,
      signaturePreview: signature?.substring(0, 10) + '...',
      hasVerifyFunction: typeof verifyPlainWebhook === 'function'
    });

    // Debug: Log available error classes
    logger.debug('Available error classes', {
      requestId,
      PlainWebhookSignatureVerificationError: typeof PlainWebhookSignatureVerificationError,
      PlainWebhookVersionMismatchError: typeof PlainWebhookVersionMismatchError,
      ManualVerificationError: typeof ManualVerificationError,
      ManualVersionError: typeof ManualVersionError
    });

    // Verify the webhook signature (try Plain SDK first, fallback to manual)
    let webhookResult;
    
    if (verifyPlainWebhook && typeof verifyPlainWebhook === 'function') {
      logger.debug('Using Plain SDK for webhook verification', { requestId });
      webhookResult = verifyPlainWebhook(rawBody, signature, config.plainSignatureSecret);
    } else {
      logger.debug('Using manual webhook verification fallback', { requestId });
      webhookResult = verifyPlainWebhookManual(rawBody, signature, config.plainSignatureSecret);
    }

    // Log webhook result details
    logger.debug('Webhook verification result', {
      requestId,
      hasError: !!webhookResult.error,
      errorMessage: webhookResult.error?.message,
      errorType: webhookResult.error?.constructor?.name,
      hasData: !!webhookResult.data
    });

    // Check for signature verification errors (handle undefined error classes)
    const isSignatureError = webhookResult.error && (
      (PlainWebhookSignatureVerificationError && webhookResult.error instanceof PlainWebhookSignatureVerificationError) ||
      (ManualVerificationError && webhookResult.error instanceof ManualVerificationError) ||
      webhookResult.error.message?.includes('signature verification failed') ||
      webhookResult.error.message?.includes('Webhook signature verification failed')
    );

    if (isSignatureError) {
      logger.warn('Failed to verify webhook signature', { 
        requestId,
        error: webhookResult.error.message,
        errorType: webhookResult.error.constructor?.name 
      });
      return res.status(401).json({ error: 'Failed to verify webhook signature' });
    }

    // Check for version mismatch errors
    const isVersionError = webhookResult.error && (
      (PlainWebhookVersionMismatchError && webhookResult.error instanceof PlainWebhookVersionMismatchError) ||
      (ManualVersionError && webhookResult.error instanceof ManualVersionError) ||
      webhookResult.error.message?.includes('version mismatch')
    );

    if (isVersionError) {
      logger.warn('Webhook version mismatch', { 
        requestId,
        error: webhookResult.error.message,
        errorType: webhookResult.error.constructor?.name
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
    const eventType = webhookData?.payload?.eventType;

    logger.info('Webhook verified successfully - FULL WEBHOOK DATA', {
      requestId,
      eventType,
      workspaceId,
      webhookDataKeys: webhookData ? Object.keys(webhookData) : 'null',
      payloadKeys: webhookData?.payload ? Object.keys(webhookData.payload) : 'null',
      fullWebhookData: webhookData, // Log the entire webhook payload
      verificationMethod: verifyPlainWebhook ? 'plain-sdk' : 'manual-fallback'
    });

    // Process based on event type
    switch (eventType) {
      case 'thread.email_received':
        await handleEmailReceived(webhookData.payload, requestId);
        break;
      
      case 'thread.chat_received':
        await handleChatReceived(webhookData.payload, requestId);
        break;
      
      case 'thread.labels_changed':
        await handleLabelsChanged(webhookData.payload, requestId);
        break;
      
      default:
        logger.debug('Unhandled event type', { requestId, eventType });
        break;
    }

    // Webhook processed successfully - ticket data already saved in handleThreadCreated

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
};

// Helper functions for processing first messages
async function processFirstMessage(thread, messageContent, requestId) {
  logger.info('Processing first message for classification', {
    requestId,
    threadId: thread?.id,
    messageLength: messageContent?.length || 0,
    customerId: thread?.customer?.id,
    customerEmail: thread?.customer?.email,
    customerTier: thread?.tier?.name
  });

  try {
    // Create enhanced thread object with the actual message content
    const enhancedThread = {
      ...thread,
      allMessageContent: messageContent, // Use the actual message content from email/chat
      firstMessage: {
        textContent: messageContent
      }
    };

    const priority = await priorityClassifier.classifyThread(enhancedThread);
    
    logger.info('Thread classified', {
      requestId,
      threadId: thread.id,
      priority: priority.priority,
      confidence: priority.confidence,
      messagePreview: messageContent.substring(0, 100)
    });

    // Save ticket to database using your simple schema
    await database.saveTicket({
      threadId: thread.id,
      messageId: null, // We don't have individual message IDs from webhooks
      firstMessage: messageContent,
      priorityScore: Math.round(priority.confidence * 100), // Convert confidence to score (0-100)
      priorityBand: priority.priority,
      reasoning: `Confidence: ${priority.confidence}, Method: ${priority.method || 'rules'}, Keywords: ${priority.details?.keywordsMatched?.join(', ') || 'none'}`
    });

    if (priority.confidence >= 0.7) {
      await plainApiClient.addPriorityLabel(thread.id, priority.priority);
      
      logger.info('Priority label applied', {
        requestId,
        threadId: thread.id,
        priority: priority.priority,
        confidence: priority.confidence
      });
    } else {
      logger.info('Low confidence classification, manual review required', {
        requestId,
        threadId: thread.id,
        priority: priority.priority,
        confidence: priority.confidence
      });
    }

  } catch (error) {
    logger.error('Error processing first message', {
      requestId,
      threadId: thread?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleEmailReceived(payload, requestId) {
  const thread = payload.thread;
  const email = payload.email;
  
  logger.info('Processing email received event', {
    requestId,
    threadId: thread?.id,
    emailSubject: email?.subject,
    isStartOfThread: email?.isStartOfThread,
    hasTextContent: !!email?.textContent,
    customerId: thread?.customer?.id,
    customerEmail: thread?.customer?.email?.email
  });

  // Only process if this is the start of the thread
  if (!email?.isStartOfThread) {
    logger.info('Email received but not start of thread, skipping', {
      requestId,
      threadId: thread.id,
      isStartOfThread: email?.isStartOfThread
    });
    return;
  }

  try {
    // Check if this thread already exists in our database
    const existingTicket = await database.getTicket(thread.id);
    
    if (existingTicket) {
      logger.info('Thread already processed, skipping classification', {
        requestId,
        threadId: thread.id,
        existingPriority: existingTicket.priority_band
      });
      return;
    }

    // Fetch full thread details including tier information
    logger.info('Fetching full thread details for tier and classification', {
      requestId,
      threadId: thread.id
    });
    
    const fullThread = await plainApiClient.getThread(thread.id);
    const messageContent = email?.textContent || email?.subject || '';
    
    await processFirstMessage(fullThread, messageContent, requestId);

  } catch (error) {
    logger.error('Error processing email received event', {
      requestId,
      threadId: thread?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

async function handleChatReceived(payload, requestId) {
  const thread = payload.thread;
  const chat = payload.chat;
  
  logger.info('Processing chat received event', {
    requestId,
    threadId: thread?.id,
    hasText: !!chat?.text,
    customerId: thread?.customer?.id,
    customerEmail: thread?.customer?.email?.email
  });

  try {
    // Check if this thread already exists in our database
    const existingTicket = await database.getTicket(thread.id);
    
    if (existingTicket) {
      logger.info('Thread already processed, skipping classification', {
        requestId,
        threadId: thread.id,
        existingPriority: existingTicket.priority_band
      });
      return;
    }

    // Fetch full thread details including tier information
    logger.info('Fetching full thread details for tier and classification', {
      requestId,
      threadId: thread.id
    });
    
    const fullThread = await plainApiClient.getThread(thread.id);
    const messageContent = chat?.text || '';
    
    await processFirstMessage(fullThread, messageContent, requestId);

  } catch (error) {
    logger.error('Error processing chat received event', {
      requestId,
      threadId: thread?.id,
      error: error.message,
      stack: error.stack
    });
  }
}

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
  }
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}