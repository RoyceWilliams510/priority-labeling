const databaseService = require('../src/services/database');

module.exports = async (req, res) => {
  const startTime = process.hrtime();
  
  // Check database connection
  let databaseStatus = 'disconnected';
  let databaseError = null;
  
  try {
    if (databaseService.isConnected) {
      databaseStatus = 'connected';
    } else {
      // Try to initialize connection if not already connected
      await databaseService.initialize();
      databaseStatus = databaseService.isConnected ? 'connected' : 'disconnected';
    }
  } catch (error) {
    databaseStatus = 'error';
    databaseError = error.message;
  }
  
  const [seconds, nanoseconds] = process.hrtime(startTime);
  const uptime = seconds + nanoseconds / 1e9;
  
  const healthStatus = {
    status: databaseStatus === 'connected' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: uptime,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'production',
    platform: 'vercel-serverless',
    database: databaseStatus,
    services: {
      database: {
        status: databaseStatus,
        error: databaseError
      }
    }
  };
  
  // Return appropriate HTTP status code
  const httpStatus = databaseStatus === 'connected' ? 200 : 503;
  
  res.status(httpStatus).json(healthStatus);
};
