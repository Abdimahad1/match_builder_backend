// server.js (or index.js)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
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

// WebSocket server with performance optimizations
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 1024 * 1024, // 1MB max payload
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    }
  }
});

// Store connected WebSocket clients
const connectedClients = new Map();

// WebSocket connection handler with timeout
wss.on('connection', (ws, request) => {
  const connectionStart = Date.now();
  console.log('🔌 New WebSocket connection attempt');

  // Set authentication timeout (5 seconds)
  const authTimeout = setTimeout(() => {
    if (ws.readyState === ws.OPEN) {
      console.log('⏰ WebSocket authentication timeout');
      ws.close(1008, 'Authentication timeout');
    }
  }, 5000);

  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.log('❌ No token provided, closing WebSocket');
    ws.close(1008, 'Authentication required');
    clearTimeout(authTimeout);
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;
    
    clearTimeout(authTimeout);
    
    const connectionTime = Date.now() - connectionStart;
    console.log(`✅ WS authenticated: ${userId} in ${connectionTime}ms`);
    
    connectedClients.set(userId, ws);
    console.log('👥 Total WebSocket clients:', connectedClients.size);

    // Send minimal connection confirmation
    const connectionMsg = JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      timestamp: Date.now()
    });
    
    if (ws.readyState === ws.OPEN) {
      ws.send(connectionMsg);
    }

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        // Only handle PING for performance
        if (data.type === 'PING') {
          const pongMsg = JSON.stringify({
            type: 'PONG',
            timestamp: Date.now()
          });
          
          if (ws.readyState === ws.OPEN) {
            ws.send(pongMsg);
          }
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
    clearTimeout(authTimeout);
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
    } catch (err) {
      console.error(`Broadcast error to ${userId}:`, err);
      connectedClients.delete(userId);
    }
  }
};

// ----------------------
// PERFORMANCE MIDDLEWARE
// ----------------------

// Compression with optimized settings
app.use(compression({
  level: 6, // Balanced compression level
  threshold: 1024, // Compress responses larger than 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Optimized CORS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  maxAge: 86400 // 24 hours cache for preflight
}));

// Optimized body parsing - reduced limits for login
app.use(express.json({ 
  limit: '500kb', // Reduced from 10mb for login
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: false, 
  limit: '500kb' // Reduced from 10mb
}));

// Performance monitoring middleware
app.use((req, res, next) => {
  const start = Date.now();
  req.requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  // Essential headers only
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'X-Response-Time, X-Request-ID');
  
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
    res.setHeader('X-Request-ID', req.requestId);
    
    // Only log slow requests (>500ms) for performance
    if (duration > 500) {
      console.log(`🐌 ${req.method} ${req.originalUrl} - ${duration}ms - ID: ${req.requestId}`);
    } else if (req.originalUrl.includes('/api/auth')) {
      console.log(`⚡ ${req.method} ${req.originalUrl} - ${duration}ms - ID: ${req.requestId}`);
    }

    originalEnd.call(this, chunk, encoding);
  };

  next();
});

// Cache GET requests (skip for auth routes)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.includes('/api/auth')) {
    res.set('Cache-Control', 'public, max-age=300');
  }
  next();
});

// ----------------------
// HIGH-PERFORMANCE ROUTES
// ----------------------

app.use('/api/auth', (await import('./routes/authRoutes.js')).default);
app.use('/api/leagues', (await import('./routes/leagueRoutes.js')).default);

// Optimized health endpoints
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server healthy',
    timestamp: Date.now(),
    uptime: process.uptime(),
    connectedClients: connectedClients.size,
  });
});

app.get('/api/ws-health', (req, res) => {
  res.json({
    success: true,
    message: 'WebSocket running',
    connectedClients: connectedClients.size,
    timestamp: Date.now(),
  });
});

// CORS test - minimal response
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS working',
    yourOrigin: req.headers.origin || 'No origin',
    timestamp: Date.now(),
  });
});

// API Root - minimal response
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Face2Face League API running',
    version: '1.0.0',
    timestamp: Date.now(),
  });
});

// 404 Handler - minimal
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Error Handler - optimized
app.use((error, req, res, next) => {
  console.error('Server Error:', error);

  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? undefined : error.message,
    timestamp: Date.now(),
  });
});

// ----------------------
// START SERVER
// ----------------------

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 WebSocket path: /ws`);
  console.log(`⚡ Performance Mode: ENABLED`);
  console.log(`📊 Max Payload: 1MB`);
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