const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { RateLimiterMemory } = require('rate-limiter-flexible');
require('dotenv').config();

const webhookHandler = require('./handlers/webhookHandler');
const logger = require('./utils/logger');
const config = require('./config/config');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
}));

// Rate limiting
const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: config.rateLimitMaxRequests,
  duration: config.rateLimitWindowMs / 1000,
});

app.use(async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Too Many Requests' });
  }
});

// Logging middleware
app.use(morgan(config.logFormat, {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Raw body parsing for webhook signature verification
app.use(config.webhookEndpointPath, express.text());

// JSON parsing for other endpoints
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Webhook endpoints
app.post(config.webhookEndpointPath, webhookHandler.handlePlainWebhook);

// Metrics endpoint (for monitoring)
app.get('/metrics', (req, res) => {
  // TODO: Implement metrics collection
  res.status(200).json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  logger.warn('404 - Route not found', { method: req.method, path: req.path });
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { 
    error: err.message, 
    stack: err.stack,
    method: req.method,
    path: req.path 
  });
  
  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message 
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const PORT = config.port;
const HOST = config.host;

app.listen(PORT, HOST, () => {
  logger.info(`Plain Priority Labeling Server started`, {
    port: PORT,
    host: HOST,
    environment: process.env.NODE_ENV || 'development',
    webhookPath: config.webhookEndpointPath
  });
});

module.exports = app;
