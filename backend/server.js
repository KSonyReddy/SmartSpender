import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import connectDB from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import vendorRoutes from './routes/vendorRoutes.js';
import bookingRoutes from './routes/bookingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import venueSearchRoutes from './routes/venueSearchRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const require = createRequire(import.meta.url);

const frontendRoot = path.join(__dirname, '../frontend');
const indexHtml = path.join(frontendRoot, 'index.html');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 5000);
const MONGO_URI = process.env.MONGODB_URI;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB max
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG/PNG/GIF/WEBP images allowed'));
  },
});
app.locals.upload = upload;

if (!MONGO_URI) {
  console.error('❌ MONGODB_URI is required for server startup.');
  process.exit(1);
}

function getMongoStateLabel() {
  switch (mongoose.connection.readyState) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'unknown';
  }
}

const allowedOrigins = new Set([
  'http://localhost:5000',
  'http://localhost:5002',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5002',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080',

   'https://smartspender-1-m3j5.onrender.com'
]);

function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(origin || '').trim());
}

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GENERAL_RATE_LIMIT_MAX || (isProduction ? 100 : 1000)),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.',
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please wait before retrying.',
  },
});

const aiChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.AI_CHAT_RATE_LIMIT_MAX || (isProduction ? 60 : 1000)),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction,
  keyGenerator: (req) => String(req.session?.userId || req.ip || 'anonymous'),
  message: {
    success: false,
    message: 'AI chat limit reached for this hour. Please try again later.',
  },
});

// ==================== Middleware ====================
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || (!isProduction && isLocalhostOrigin(origin))) return callback(null, true);
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
        connectSrc: [
          "'self'",
          'http://localhost:5000',
          'http://localhost:5002',
          'http://127.0.0.1:5000',
          'http://127.0.0.1:5002',
          'ws://localhost:5000',
          'ws://localhost:5002',
          'https://maps.googleapis.com',
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
);
app.use(compression());
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Session middleware
app.use(
  session({
    name: 'connect.sid',
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: MongoStore.create({
      mongoUrl: MONGO_URI,
      collectionName: 'sessions',
      ttl: 86400,
    }),
    cookie: {
      secure: isProduction,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 24 hours
      sameSite: isProduction ? 'none' : 'lax',
    },
  }),
);

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/ai/chat', aiChatLimiter);

// ==================== Health Check ====================
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    mongoState: getMongoStateLabel(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ==================== Config Endpoint ====================
app.get('/api/config', (req, res) => {
  res.status(200).json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  });
});

// ==================== Routes ====================
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/venues', venueSearchRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/vendor', vendorRoutes);
app.use('/api/vendor', bookingRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);

// ==================== API 404 JSON ====================
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found',
  });
});

// ==================== Frontend GUI ====================
app.use(express.static(frontendRoot));

// Catch-all SPA fallback (non-API routes)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  return res.sendFile(indexHtml);
});

// ==================== Error Handling ====================
app.use((err, req, res, next) => {
  console.error('Error:', err);

  if (err?.message === 'CORS origin not allowed') {
    return res.status(403).json({
      success: false,
      message: 'CORS origin not allowed',
      code: 'cors_origin_blocked',
    });
  }

  if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      details,
    });
  }

  if (err?.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid ${err.path}: ${err.value}`,
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(isProduction ? {} : { stack: err.stack }),
  });
});

// ==================== Server Start ====================
let server;

async function startServer() {
  await connectDB();
  server = app.listen(PORT, () => {
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  });
}

startServer().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});

// ==================== Graceful Shutdown ====================
async function shutdown(signal) {
  console.log(`${signal} received. Shutting down gracefully...`);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(async () => {
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    } catch (e) {
      console.error('Error during MongoDB disconnect:', e.message);
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
