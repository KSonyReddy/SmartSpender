// Simple inline mock to replace deleted mockOpenAI.js
const mockOpenAI = {
  getAnalysisResponse: (dataContext) => {
    return `Analysis summary for provided data (mock).`;
  },
  getRecommendationsResponse: (currentBudget, targetSavings) => {
    return `Recommendations mock for budget ${currentBudget} and target ${targetSavings}.`;
  },
};

export class AnalysisAgent {
  constructor() {
    this.systemPrompt = `You are a financial analysis AI specialist.`;
  }

  async analyzeData(userId, dataContext) {
    try {
      const analysis = mockOpenAI.getAnalysisResponse(dataContext);
      return {
        success: true,
        analysis: analysis,
        tokens_used: 500,
      };
    } catch (error) {
      console.error('Analysis agent error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async analyzeCategory(categoryName, expenses) {
    try {
      const prompt = `Analyze ${categoryName} category with ${expenses.length} transactions`;
      const analysis = mockOpenAI.getAnalysisResponse(prompt);
      return {
        success: true,
        categoryAnalysis: analysis,
      };
    } catch (error) {
      console.error('Category analysis error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async generateRecommendations(currentBudget, targetSavings) {
    try {
      const summary = mockOpenAI.getRecommendationsResponse(currentBudget, targetSavings);
      const budget = Number(currentBudget);
      const savings = Number(targetSavings);
      if (!budget || !savings || savings >= budget) {
        throw new Error('Invalid budget inputs');
      }
      const savingsPct = savings / budget;
      let essentialsPct = 0.5;
      let wantsPct = 1 - essentialsPct - savingsPct;
      if (wantsPct < 0) {
        const deficit = -wantsPct;
        essentialsPct = Math.max(0.4, essentialsPct - deficit);
        wantsPct = 0;
      }
      const allocations = {
        savings: { amount: Math.round(savings), percent: +(savingsPct * 100).toFixed(2) },
        essentials: { amount: Math.round(budget * essentialsPct), percent: +(essentialsPct * 100).toFixed(2) },
        wants: { amount: Math.round(budget * wantsPct), percent: +(wantsPct * 100).toFixed(2) },
      };
      const actions = {
        immediate: ['Create expense tracker', 'Cancel unused subscriptions', 'Auto-transfer to savings'],
        shortTerm: ['Meal plan and grocery strategy', 'Reduce dining out', 'Review utility bills'],
        mediumTerm: ['Carpool/transit options', 'Review insurance rates', 'Explore side income'],
        longTerm: ['Monthly budget reviews', 'Build emergency fund', 'Invest savings'],
      };
      const plan = {
        inputs: { currentBudget: budget, targetSavings: savings },
        allocations,
        actions,
        summary,
      };
      return { success: true, recommendations: summary, plan };
    } catch (error) {
      console.error('Recommendations error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

export default new AnalysisAgent();

