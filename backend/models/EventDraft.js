import mongoose from 'mongoose';

const eventDraftSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    step: {
      type: Number,
      default: 0, // 0: event_type, 1: city/area, 2: date, 3: guests, 4: religion, 5: budget, 6: requirements
    },
    answers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    completed: {
      type: Boolean,
      default: false,
    },
    servicesAlreadySelected: {
      type: Boolean,
      default: false,
      description: 'Flag to prevent asking for services twice in same conversation',
    },
    sessionId: {
      type: String,
      default: 'default',
      index: true,
    },
  },
  { timestamps: true, collection: 'event_drafts' }
);

export const EventDraft = mongoose.model('EventDraft', eventDraftSchema);

