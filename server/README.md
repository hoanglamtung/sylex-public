# Server - Car Assistant Pro Cloud Backend

This directory contains the cloud backend services that power the Car Assistant Pro voice assistant ecosystem.

## Technologies
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **ASR Providers**: Azure Cognitive Services, OpenAI Whisper
- **Real-time**: WebSocket support (planned)
- **Security**: Helmet, CORS, Rate limiting
- **Logging**: Winston
- **Deployment**: Docker ready

## Architecture Components
- REST API endpoints (OpenAPI 3.0 spec)
- ASR (Automatic Speech Recognition)
- NLU/Chat (planned for Phase 2)
- TTS (Text-to-Speech, planned for Phase 2)
- Rate limiting and security middleware
- Structured error handling
- Request tracing

## Current Implementation Status

### ✅ Completed (Phase 1)
- OpenAPI 3.0 specification (`openapi.yaml`)
- Express server with security middleware
- ASR endpoint (`POST /v1/asr`) with Azure and OpenAI integration
- Health check endpoint (`GET /v1/health`)
- Rate limiting (100 req/min for ASR)
- File upload validation (10MB max, WAV/MP3/FLAC/OGG)
- Error handling with standardized error codes
- Request ID tracking
- Winston logging

### 🚧 Planned (Phase 2)
- Chat/NLU endpoint implementation
- TTS endpoint implementation
- WebSocket streaming for real-time ASR
- Authentication (JWT)
- Database integration (MongoDB)
- User profile management
- Navigation services integration

## Development Setup

### Prerequisites
- Node.js 18+ (LTS)
- npm or yarn
- Cloud provider account (Azure or OpenAI)

### Installation

```bash
cd server
npm install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:

For **Azure Cognitive Services**:
```env
ASR_PROVIDER=azure
AZURE_SPEECH_KEY=your_key_here
AZURE_SPEECH_REGION=westeurope
```

For **OpenAI Whisper**:
```env
ASR_PROVIDER=openai
OPENAI_API_KEY=your_key_here
```

### Running the Server

**Development mode** (with auto-reload):
```bash
npm run dev
```

**Production mode**:
```bash
npm start
```

The server will start on `http://localhost:3000`

## API Documentation

### Endpoints

| Method | Endpoint | Description | Status |
|--------|----------|-------------|--------|
| GET | `/v1/health` | Health check | ✅ Implemented |
| POST | `/v1/asr` | Speech to text | ✅ Implemented |
| POST | `/v1/asr/stream` | Streaming ASR | 🚧 Planned |
| POST | `/v1/chat` | NLU/dialogue | 🚧 Planned |
| POST | `/v1/tts` | Text to speech | 🚧 Planned |

### Full API Specification

See `openapi.yaml` for complete OpenAPI 3.0 specification including:
- Request/response schemas
- Error codes and handling
- Rate limits
- Authentication (planned)
- All endpoint details

View in browser: `http://localhost:3000/openapi.yaml`

### Example: ASR Request

```bash
curl -X POST http://localhost:3000/v1/asr \
  -H "Content-Type: multipart/form-data" \
  -F "audio=@recording.wav" \
  -F "language=de-DE" \
  -F "enableProfanityFilter=true"
```

Response:
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "transcript": "Navigiere zum nächsten Ladepunkt",
  "confidence": 0.95,
  "language": "de-DE",
  "alternatives": [],
  "processingTimeMs": 287
}
```

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/asr` | 100 requests | 60 seconds |
| `/chat` | 200 requests | 60 seconds |
| `/tts` | 100 requests | 60 seconds |

Configurable via environment variables.

## Error Handling

All errors follow standardized format:

```json
{
  "error": {
    "code": "INVALID_AUDIO_FORMAT",
    "message": "Unsupported audio format. Supported formats: WAV, MP3, FLAC, OGG",
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### Error Codes
- `INVALID_REQUEST` - Missing or invalid parameters
- `INVALID_AUDIO_FORMAT` - Unsupported audio format
- `AUDIO_TOO_LARGE` - File exceeds size limit
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `PROVIDER_ERROR` - Cloud provider error
- `INTERNAL_ERROR` - Server error
- `SERVICE_UNAVAILABLE` - Service down

## Testing

```bash
npm test
```

## Project Structure

```
server/
├── openapi.yaml           # OpenAPI 3.0 specification
├── package.json
├── .env.example
├── src/
│   ├── index.js          # Server entry point
│   ├── routes/
│   │   ├── asr.js        # ASR endpoint
│   │   ├── chat.js       # Chat endpoint (stub)
│   │   ├── tts.js        # TTS endpoint (stub)
│   │   └── health.js     # Health check
│   ├── services/
│   │   └── asrService.js # ASR cloud provider integration
│   ├── middleware/
│   │   └── errorHandler.js
│   └── utils/
│       ├── logger.js
│       └── errors.js
```

## Deployment

### Docker (Coming Soon)

```bash
docker build -t car-assistant-pro-server .
docker run -p 3000:3000 --env-file .env car-assistant-pro-server
```

## Related Issues

- #63: Backend: define REST API spec (/asr, /chat, /tts) ✅
- #64: Backend: implement /asr (cloud provider integration) ✅

## License

Proprietary