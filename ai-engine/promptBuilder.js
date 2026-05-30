/**
 * Prompt Builder Module
 * Constructs AI prompts for budget recommendations
 */

class PromptBuilder {
  constructor() {
    this.basePrompt =
      "You are a financial AI assistant specializing in personal budgeting.";
  }

  buildBudgetAnalysisPrompt(budgetData) {
    return `${this.basePrompt} Please analyze the following budget data: ${JSON.stringify(budgetData)}. Identify any areas of overspending and provide actionable advice.`;
  }

  buildRecommendationPrompt(expenses, income) {
    return `${this.basePrompt} Given a monthly income of ${income} and the following expenses: ${JSON.stringify(expenses)}, provide 3 specific recommendations to improve savings.`;
  }
}

module.exports = PromptBuilder;
