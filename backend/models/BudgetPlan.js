import mongoose from "mongoose";

const budgetPlanSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    questionnaire: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    clientPlan: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    aiPlan: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true, collection: "budget_plans" },
);

budgetPlanSchema.index({ userId: 1, createdAt: -1 });
budgetPlanSchema.index({ userId: 1, updatedAt: -1 });

export const BudgetPlan = mongoose.model("BudgetPlan", budgetPlanSchema);
