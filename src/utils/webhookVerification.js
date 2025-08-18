const crypto = require('crypto');

/**
 * Manual webhook signature verification for Plain webhooks
 * This is a fallback if the Plain SDK import doesn't work in serverless
 */

/**
 * Verify Plain webhook signature manually
 * @param {string} payload - Raw webhook payload
 * @param {string} signature - Plain-Request-Signature header value
 * @param {string} secret - Plain webhook signing secret
 * @returns {Object} Verification result
 */
function verifyPlainWebhookManual(payload, signature, secret) {
  try {
    // Plain uses HMAC-SHA256 for webhook signatures
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    // Plain signature format is typically "sha256=<hash>"
    const providedHash = signature.replace('sha256=', '');
    
    // Use constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(providedHash, 'hex')
    );
    
    if (isValid) {
      // Try to parse the payload
      let parsedPayload;
      try {
        parsedPayload = JSON.parse(payload);
      } catch (parseError) {
        return {
          error: new Error(`Invalid JSON payload: ${parseError.message}`),
          data: null
        };
      }
      
      return {
        error: null,
        data: parsedPayload
      };
    } else {
      return {
        error: new Error('Webhook signature verification failed'),
        data: null
      };
    }
    
  } catch (error) {
    return {
      error: new Error(`Signature verification error: ${error.message}`),
      data: null
    };
  }
}

/**
 * Custom error classes to match Plain SDK
 */
class PlainWebhookSignatureVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlainWebhookSignatureVerificationError';
  }
}

class PlainWebhookVersionMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlainWebhookVersionMismatchError';
  }
}

module.exports = {
  verifyPlainWebhookManual,
  PlainWebhookSignatureVerificationError,
  PlainWebhookVersionMismatchError
};
