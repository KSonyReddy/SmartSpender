import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    event_plan: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
      default: null,
    },
    usage: {
      type: {
        prompt_tokens: Number,
        completion_tokens: Number,
        total_tokens: Number,
      },
      required: false,
      default: null,
    },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const chatConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    messages: {
      type: [chatMessageSchema],
      default: [],
    },
  },
  { timestamps: true, collection: 'chat_conversations' }
);

export const ChatConversation = mongoose.model('ChatConversation', chatConversationSchema);

export const MAX_CHAT_MESSAGES = 100;
