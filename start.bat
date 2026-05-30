@echo off
echo Starting Budget AI Server...
cd /d "%~dp0backend"

IF NOT EXIST "node_modules\" (
  echo Installing dependencies...
  npm install
)

echo Server starting on http://localhost:5000
npm run dev
