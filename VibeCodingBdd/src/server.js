require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Health check endpoint (required for Railway)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Simple status endpoint
app.get('/api/status', (req, res) => {
  res.status(200).json({ 
    service: 'FearSearchSite',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Database connection test
app.get('/api/db-health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.status(200).json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: result.rows[0].now 
    });
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(503).json({ 
      status: 'error', 
      message: 'Database connection failed',
      error: err.message 
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>FearSearch Site</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
          .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          h1 { color: #333; }
          .status { padding: 10px; background: #e8f5e9; border-radius: 4px; margin: 10px 0; }
          a { color: #1976d2; text-decoration: none; margin-right: 20px; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔍 FearSearch Site</h1>
          <div class="status">✅ Server is running</div>
          <p>Service: FearSearchSite</p>
          <p>Environment: ${process.env.NODE_ENV || 'production'}</p>
          <p>
            <a href="/api/health">Health Check</a>
            <a href="/api/status">Status</a>
            <a href="/api/db-health">DB Health</a>
          </p>
        </div>
      </body>
    </html>
  `);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    status: 'error', 
    message: 'Internal server error',
    error: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] NODE_ENV: ${process.env.NODE_ENV || 'production'}`);
  console.log(`[${new Date().toISOString()}] Database URL configured: ${process.env.DATABASE_URL ? 'yes' : 'no'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  pool.end();
  process.exit(0);
});

