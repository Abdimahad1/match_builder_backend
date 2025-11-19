import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import connectDB from './config/db.js';

// Load env vars
dotenv.config();

// Connect to database with optimized settings
connectDB();

const app = express();
const server = createServer(app); // Create HTTP server for both Express and WebSockets

// WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/ws'
});

// Store connected clients
const connectedClients = new Map();

// WebSocket connection handling
wss.on('connection', (ws, request) => {
  console.log('🔌 New WebSocket connection attempt');
  
  // Extract token from URL query parameters
  const url = new URL(request.url, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');
  
  if (!token) {
    console.log('❌ No token provided, closing connection');
    ws.close(1008, 'Authentication required');
    return;
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;
    
    console.log(`✅ WebSocket authenticated for user: ${userId}`);
    
    // Store the connection
    connectedClients.set(userId, ws);
    console.log(`👥 Total connected clients: ${connectedClients.size}`);
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      message: 'WebSocket connection established',
      timestamp: new Date().toISOString()
    }));

    // Handle messages from client
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        console.log('📨 Received WebSocket message from user', userId, ':', data);
        
        // Handle different message types
        switch (data.type) {
          case 'PING':
            ws.send(JSON.stringify({
              type: 'PONG',
              timestamp: new Date().toISOString()
            }));
            break;
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket connection closed for user ${userId}:`, {
        code,
        reason: reason.toString(),
        connectedClients: connectedClients.size
      });
      connectedClients.delete(userId);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for user ${userId}:`, error);
      connectedClients.delete(userId);
    });

  } catch (error) {
    console.log('❌ Invalid token, closing connection:', error.message);
    ws.close(1008, 'Invalid authentication token');
  }
});

// Broadcast function to send messages to all connected clients
const broadcastToAll = (message) => {
  const messageString = JSON.stringify(message);
  let sentCount = 0;
  
  connectedClients.forEach((ws, userId) => {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(messageString);
        sentCount++;
      } catch (error) {
        console.error(`Error sending message to user ${userId}:`, error);
        connectedClients.delete(userId);
      }
    }
  });
  
  console.log(`📢 Broadcast sent to ${sentCount} clients`);
};

// Broadcast function to specific user
const broadcastToUser = (userId, message) => {
  const ws = connectedClients.get(userId);
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(message));
      console.log(`📨 Message sent to user: ${userId}`);
    } catch (error) {
      console.error(`Error sending message to user ${userId}:`, error);
      connectedClients.delete(userId);
    }
  }
};

// Broadcast function to multiple users
const broadcastToUsers = (userIds, message) => {
  const messageString = JSON.stringify(message);
  let sentCount = 0;
  
  userIds.forEach(userId => {
    const ws = connectedClients.get(userId);
    if (ws && ws.readyState === ws.OPEN) {
      try {
        ws.send(messageString);
        sentCount++;
      } catch (error) {
        console.error(`Error sending message to user ${userId}:`, error);
        connectedClients.delete(userId);
      }
    }
  });
  
  console.log(`📨 Message sent to ${sentCount} users`);
};

// Simple CORS configuration
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
}));

// Body parser with limits
app.use(express.json({ 
  limit: '10mb'
}));
app.use(express.urlencoded({ 
  extended: false, 
  limit: '10mb' 
}));

// Fixed response time header middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  // Store original end method
  const originalEnd = res.end;
  
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    res.setHeader('X-Response-Time', `${duration}ms`);
    console.log(`${req.method} ${req.originalUrl} - ${duration}ms`);
    
    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
});

// Cache control for static responses
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=300'); // 5 minutes cache
  }
  next();
});

// Routes
app.use('/api/auth', (await import('./routes/authRoutes.js')).default);
app.use('/api/leagues', (await import('./routes/leagueRoutes.js')).default);

// WebSocket health check
app.get('/api/ws-health', (req, res) => {
  res.json({
    success: true,
    message: 'WebSocket server is running',
    connectedClients: connectedClients.size,
    timestamp: new Date().toISOString()
  });
});

// WebSocket test endpoint - send a test message to all connected clients
app.get('/api/ws-test', (req, res) => {
  // Test broadcast to all clients
  broadcastToAll({
    type: 'TEST_MESSAGE',
    message: 'This is a test broadcast from the server',
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    message: 'Test broadcast sent to all connected clients',
    connectedClients: connectedClients.size
  });
});

// WebSocket test endpoint for specific user
app.get('/api/ws-test/:userId', (req, res) => {
  const { userId } = req.params;
  
  broadcastToUser(userId, {
    type: 'TEST_MESSAGE',
    message: `Test message for user ${userId}`,
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    message: `Test message sent to user ${userId}`,
    userConnected: connectedClients.has(userId)
  });
});

// Basic route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Face2Face League API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    websocket: true,
    connectedClients: connectedClients.size
  });
});

// Health check route (no database query for speed)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    connectedClients: connectedClients.size,
    memoryUsage: process.memoryUsage()
  });
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? {} : error.message
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`📡 CORS enabled for ALL origins`);
  console.log(`🔌 WebSocket server running on path /ws`);
  console.log(`⚡ Performance optimizations enabled`);
  console.log(`👥 Currently ${connectedClients.size} connected WebSocket clients`);
});

// Cleanup function for graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  
  // Close all WebSocket connections
  connectedClients.forEach((ws, userId) => {
    ws.close(1001, 'Server shutting down');
  });
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  
  // Close all WebSocket connections
  connectedClients.forEach((ws, userId) => {
    ws.close(1001, 'Server shutting down');
  });
  
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Export the broadcast functions
export { broadcastToAll, broadcastToUser, broadcastToUsers };
