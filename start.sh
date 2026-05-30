#!/bin/bash
echo "🚀 Starting Budget AI Server..."
cd "$(dirname "$0")/backend"

if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

echo "✅ Starting server on http://localhost:5000"
npm run dev
