import mongoose from "mongoose";

const eventPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    eventDraftSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    vendorShortlist: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    planText: {
      type: String,
      required: true,
    },
    eventPlan: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true, collection: "event_plans" },
);

eventPlanSchema.index({ userId: 1, createdAt: -1 });
eventPlanSchema.index({ userId: 1, updatedAt: -1 });

export const EventPlan = mongoose.model("EventPlan", eventPlanSchema);
