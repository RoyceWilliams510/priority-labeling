# Plain Priority Labeling Service

An AI-powered webhook service that automatically classifies and labels customer support tickets in Plain according to custom company-defined priority guidelines (P0–P3).

## Overview

This service receives webhooks from Plain when new tickets (threads) are created, analyzes the content using a rules-based classifier with optional AI enhancement, and automatically applies appropriate priority labels to help support teams prioritize their work.

## Features

- 🎯 **Automatic Priority Classification**: P0 (Critical) to P3 (Low) based on configurable rules
- 🔗 **Plain Integration**: Secure webhook handling with signature verification
- 🧠 **Rules Engine**: Keyword matching, customer tier evaluation, and time-based prioritization
- 🤖 **AI Enhancement**: Optional OpenAI integration for improved classification accuracy
- 📊 **Audit Logging**: Complete audit trail of all classification decisions
- 🔒 **Security**: Rate limiting, input validation, and secure API communication
- 📈 **Monitoring**: Health checks, metrics endpoint, and structured logging

## Architecture

```
Plain Webhook → Express Server → Priority Classifier → Plain API
                     ↓
              Winston Logging & Audit Trail
```

## Prerequisites

- Node.js 18+
- Plain workspace with API access
- Environment variables configured (see Setup section)

## Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd plain-priority-labeling
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp env.example .env
```

Required environment variables:

```bash
# Plain API Configuration
PLAIN_API_TOKEN=your_plain_api_token_here
PLAIN_SIGNATURE_SECRET=your_plain_webhook_signature_secret_here

# Priority Label Configuration
LABEL_P0_ID=your_p0_label_type_id_here
LABEL_P1_ID=your_p1_label_type_id_here
LABEL_P2_ID=your_p2_label_type_id_here
LABEL_P3_ID=your_p3_label_type_id_here
```

### 3. Create Priority Labels in Plain

1. Go to Plain Settings → Manage Labels
2. Create four label types:
   - **P0 - Critical** (🔥 icon recommended)
   - **P1 - High** (⚠️ icon recommended)
   - **P2 - Medium** (📋 icon recommended)
   - **P3 - Low** (📝 icon recommended)
3. Copy each label type ID to your `.env` file

### 4. Create Plain API Key

1. Go to Plain Settings → Machine Users
2. Click "Add Machine User"
3. Create an API key with these permissions:
   - `thread:read`
   - `thread:edit`
   - `label:create`
   - `label:read`
   - `customer:read`
   - `threadEvent:create`

### 5. Set Up Webhook in Plain

1. Go to Plain Settings → Webhooks
2. Click "Add webhook target"
3. Configure:
   - **Name**: "Priority Labeling Service"
   - **URL**: `https://your-domain.com/webhook/plain`
   - **Events**: Select "Thread created" and optionally "Email received"
   - **Version**: Use the latest version

## Running the Service

### Development

```bash
npm run dev
```

The server will start on `http://localhost:3000` with auto-reload on file changes.

### Production

```bash
npm start
```

### Using Docker

```bash
# Build the image
docker build -t plain-priority-labeling .

# Run the container
docker run -d \\
  --name priority-labeling \\
  -p 3000:3000 \\
  --env-file .env \\
  plain-priority-labeling
```

### Using Docker Compose

```bash
docker-compose up -d
```

## API Endpoints

- `GET /health` - Health check endpoint
- `POST /webhook/plain` - Plain webhook endpoint
- `GET /metrics` - Basic metrics for monitoring

## Priority Classification Rules

The service uses a multi-factor approach to classify ticket priority:

### P0 - Critical (Immediate Response)
- **Keywords**: down, outage, critical, emergency, security breach, data loss
- **Customer Tiers**: Enterprise, Premium
- **Response Time**: 15 minutes
- **Auto-escalation**: Yes

### P1 - High (Same Day Response)
- **Keywords**: bug, error, issue, not working, integration, billing
- **Customer Tiers**: Enterprise, Premium, Standard
- **Response Time**: 8 hours
- **Auto-escalation**: No

### P2 - Medium (Next Business Day)
- **Keywords**: question, help, how to, documentation, training
- **Customer Tiers**: Standard, Basic
- **Response Time**: 24 hours
- **Auto-escalation**: No

### P3 - Low (Up to 3 Business Days)
- **Keywords**: feedback, suggestion, enhancement, minor improvement
- **Customer Tiers**: Basic, Trial
- **Response Time**: 72 hours
- **Auto-escalation**: No

## Configuration

Priority rules can be customized in `src/config/config.js`. You can modify:

- Keywords for each priority level
- Customer tier mappings
- Time thresholds
- Confidence requirements
- Escalation rules

## Monitoring and Logging

The service provides comprehensive logging and monitoring:

### Logs
- **Location**: Console output (development) or `logs/` directory (production)
- **Format**: Structured JSON with timestamps
- **Levels**: error, warn, info, debug

### Health Checks
- **Endpoint**: `GET /health`
- **Response**: Service status, uptime, version

### Metrics
- **Endpoint**: `GET /metrics`
- **Data**: Memory usage, uptime, processing stats

## Troubleshooting

### Common Issues

1. **Webhook signature verification fails**
   - Check `PLAIN_SIGNATURE_SECRET` is correct
   - Ensure raw body is passed to verification function

2. **Labels not being applied**
   - Verify label type IDs in environment variables
   - Check API key has `label:create` permission
   - Review classification confidence threshold

3. **High memory usage**
   - Check log level configuration
   - Monitor for memory leaks in long-running processes

### Debug Mode

Enable debug logging:

```bash
LOG_LEVEL=debug npm run dev
```

### Testing Webhooks Locally

Use ngrok to expose your local server:

```bash
ngrok http 3000
# Use the HTTPS URL in Plain webhook settings
```

## Security Considerations

- ✅ Webhook signature verification
- ✅ Rate limiting
- ✅ Input validation
- ✅ Secure headers (Helmet.js)
- ✅ Environment variable validation
- ✅ API key permissions scoping

## Performance

- **Webhook processing**: < 2 seconds target
- **Rate limiting**: 100 requests per 15 minutes per IP
- **Timeout**: 15 seconds for external API calls
- **Memory**: ~50MB baseline usage

## Deployment

### Environment Requirements

- Node.js 18+ runtime
- HTTPS endpoint (required by Plain)
- Persistent logging storage (recommended)
- Process manager (PM2, systemd, etc.)

### Deployment Checklist

- [ ] Environment variables configured
- [ ] Plain labels created and IDs set
- [ ] API key created with correct permissions
- [ ] Webhook target configured in Plain
- [ ] HTTPS certificate valid
- [ ] Health checks passing
- [ ] Monitoring configured

## Contributing

1. Follow the existing code style
2. Add tests for new features
3. Update documentation
4. Ensure all tests pass

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review logs for error details
3. Contact your development team
4. Open an issue in the repository

---

**Next Steps**: After deployment, monitor the classification accuracy and adjust rules as needed based on agent feedback and manual priority overrides.
