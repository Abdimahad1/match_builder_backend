import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression'; // ADD THIS
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import connectDB from './config/db.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({
  server,
  path: '/ws',
});

// Store connected WebSocket clients
const connectedClients = new Map();

// WebSocket connection handler
wss.on('connection', (ws, request) => {
  console.log('🔌 New WebSocket connection attempt');

  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.log('❌ No token provided, closing WebSocket');
    ws.close(1008, 'Authentication required');
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    console.log('✅ WS authenticated:', userId);
    connectedClients.set(userId, ws);
    console.log('👥 Total WebSocket clients:', connectedClients.size);

    ws.send(JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      message: 'WebSocket connection established',
      timestamp: new Date().toISOString(),
    }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log(`📨 WS message from ${userId}:`, data);

        if (data.type === 'PING') {
          ws.send(JSON.stringify({
            type: 'PONG',
            timestamp: new Date().toISOString(),
          }));
        }
      } catch (err) {
        console.error('WS Error parsing message:', err);
      }
    });

    ws.on('close', () => {
      console.log(`🔌 WS closed for ${userId}`);
      connectedClients.delete(userId);
    });

    ws.on('error', (error) => {
      console.error(`❌ WS error for user ${userId}:`, error);
      connectedClients.delete(userId);
    });
  } catch (error) {
    console.log('❌ Invalid WS token:', error.message);
    ws.close(1008, 'Invalid authentication token');
  }
});

// ----------------------
// BROADCAST UTILITIES
// ----------------------

const broadcastToAll = (message) => {
  const messageString = JSON.stringify(message);
  let count = 0;

  connectedClients.forEach((ws, userId) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(messageString);
        count++;
      } catch (err) {
        console.error(`Broadcast error to ${userId}:`, err);
        connectedClients.delete(userId);
      }
    }
  });

  console.log(`📢 Broadcast sent to ${count} clients`);
};

const broadcastToUser = (userId, message) => {
  const ws = connectedClients.get(userId);
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(message));
      console.log(`📨 Message sent to user ${userId}`);
    } catch (err) {
      console.error(`Broadcast error to ${userId}:`, err);
      connectedClients.delete(userId);
    }
  }
};

// ----------------------
// MIDDLEWARE - IMPROVED
// ----------------------

// Response compression for faster transfers
app.use(compression());

// CORS - Allow ALL ORIGINS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Global CORS headers + response time logging
app.use((req, res, next) => {
  const start = Date.now();

  // Enhanced CORS headers
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Request-ID,Accept');
  res.header('Access-Control-Expose-Headers', 'X-Response-Time');
  
  // Security headers
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }

  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    const duration = Date.now() - start;
    res.setHeader('X-Response-Time', `${duration}ms`);
    console.log(`${req.method} ${req.originalUrl} - ${duration}ms - Origin: ${req.headers.origin || 'direct'}`);

    originalEnd.call(this, chunk, encoding);
  };

  next();
});

// Cache GET requests
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=300');
  }
  next();
});

// ----------------------
// ROUTES
// ----------------------

app.use('/api/auth', (await import('./routes/authRoutes.js')).default);
app.use('/api/leagues', (await import('./routes/leagueRoutes.js')).default);

// Health endpoints
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connectedClients: connectedClients.size,
  });
});

app.get('/api/ws-health', (req, res) => {
  res.json({
    success: true,
    message: 'WebSocket running',
    connectedClients: connectedClients.size,
    timestamp: new Date().toISOString(),
  });
});

// CORS test
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS working for ALL origins',
    yourOrigin: req.headers.origin || 'No origin',
    timestamp: new Date().toISOString(),
  });
});

// API Root
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Face2Face League API running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Error Handler
app.use((error, req, res, next) => {
  console.error('Server Error:', error);

  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? undefined : error.message,
  });
});

// ----------------------
// START SERVER
// ----------------------

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 WebSocket path: /ws`);
  console.log(`🌍 CORS: ALL ORIGINS ALLOWED`);
  console.log(`⚡ Compression: ENABLED`);
});

// Graceful shutdown
const shutDown = () => {
  console.log('🛑 Shutting down gracefully...');
  connectedClients.forEach((ws) => ws.close(1001, 'Server shutting down'));
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);

export { broadcastToAll, broadcastToUser };