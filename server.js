import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';

// Load env vars
dotenv.config();

// Connect to database with optimized settings
connectDB();

const app = express();

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

// Basic route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Face2Face League API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Health check route (no database query for speed)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
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

app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`📡 CORS enabled for ALL origins`);
  console.log(`⚡ Performance optimizations enabled`);
});