import mongoose from 'mongoose';
import config from './index.js';

const mongooseOptions = {
  maxPoolSize: 50,
  minPoolSize: 5,
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 15000,
  socketTimeoutMS: 45000,
  retryWrites: true,
  w: 'majority',
};

let listenersAttached = false;

function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected');
  });

  mongoose.connection.on('disconnected', () => {
    console.log('❌ MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
  });
}

export default async function connectDB() {
  try {
    const mongoUri = process.env.MONGODB_URI || config.mongodb.uri;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI is not set.');
      process.exit(1);
    }

    attachConnectionListeners();
    await mongoose.connect(mongoUri, mongooseOptions);
    console.log('✅ MongoDB Atlas connection established');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
}
