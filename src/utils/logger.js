const winston = require('winston');
const config = require('../config/config');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white'
};

// Tell winston about our colors
winston.addColors(colors);

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, ...extra } = info;
    
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(extra).length > 0) {
      log += ` ${JSON.stringify(extra)}`;
    }
    
    return log;
  })
);

// Define which transports to use
const transports = [
  // Console transport
  new winston.transports.Console({
    level: config.logLevel,
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      format
    )
  })
];

// Add file transport in production
if (config.nodeEnv === 'production') {
  transports.push(
    new winston.transports.File({
      level: 'error',
      filename: 'logs/error.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.File({
      level: 'info',
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: config.logLevel,
  levels,
  format,
  transports,
  exitOnError: false
});

// Handle uncaught exceptions and rejections
logger.exceptions.handle(
  new winston.transports.File({ filename: 'logs/exceptions.log' })
);

logger.rejections.handle(
  new winston.transports.File({ filename: 'logs/rejections.log' })
);

module.exports = logger;
