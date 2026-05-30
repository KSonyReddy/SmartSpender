import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prefer workspace root .env, fallback to backend/.env for compatibility.
const rootEnvPath = path.resolve(__dirname, "../../.env");
const backendEnvPath = path.resolve(__dirname, "../.env");
const rootLoaded = dotenv.config({ path: rootEnvPath });
if (rootLoaded.error) {
  dotenv.config({ path: backendEnvPath });
}

if (process.env.NODE_ENV === "production") {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "FATAL ERROR: JWT_SECRET is not defined in production environment.",
    );
  }
  if (!process.env.MONGODB_URI) {
    throw new Error(
      "FATAL ERROR: MONGODB_URI is not defined in production environment.",
    );
  }
}

export default {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || "development",
  mongodb: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/budget-ai-app",
  },
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  },
  jwt: {
    secret:
      process.env.JWT_SECRET ||
      "your_super_secret_jwt_key_change_this_in_production",
    expire: process.env.JWT_EXPIRE || "7d",
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
  },
};
