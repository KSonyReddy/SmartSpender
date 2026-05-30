/**
 * Build the same structured plan as the frontend wizard (single source for API + persistence).
 */
function getGoalAdvice(goal) {
  const advice = {
    'Build Emergency Fund': 'Start with 3-6 months of living expenses. Begin with small deposits and increase gradually.',
    'Save for Vacation': 'Calculate your vacation costs and divide by months until your trip. Stay committed to your date!',
    'Pay Off Debt': 'Focus on high-interest debt first. Consider the avalanche method for maximum savings.',
    'Build Investments': 'Start with low-risk options like index funds or ETFs. Automate monthly contributions.',
    'Home Down Payment': 'Aim for 20% down. Use high-yield savings for this dedicated goal.',
    'Education Fund': 'Consider 529 plans or education savings accounts for tax advantages.',
    'Retirement Planning': 'Maximize employer 401k match first, then consider IRAs and investments.',
  };

  return advice[goal] || 'Stay disciplined and review your progress monthly. Adjust as needed.';
}

function buildRecommendations(income, expenses, savingsGoal, goal) {
  const recommendations = [];
  const balance = income - expenses;

  if (balance < savingsGoal) {
    const shortfall = savingsGoal - balance;
    recommendations.push({
      type: 'warning',
      title: '⚠️ Savings Goal Alert',
      content: `You're short by $${shortfall.toFixed(2)} each month to reach your savings goal. Consider reducing non-essential spending.`,
    });
  } else {
    recommendations.push({
      type: 'success',
      title: '✅ Goal Achievable',
      content: `Great news! You can achieve your $${savingsGoal.toFixed(2)} monthly savings goal with room to spare!`,
    });
  }

  recommendations.push({
    type: 'tip',
    title: '🎯 Goal-Specific Advice',
    content: getGoalAdvice(goal),
  });

  recommendations.push({
    type: 'tip',
    title: '📈 Budget Rule',
    content: 'Follow the 50/30/20 rule: 50% needs, 30% wants, 20% savings. Adjust based on your situation.',
  });

  return recommendations;
}

export function computeBudgetPlanFromAnswers(answers) {
  const income = parseFloat(answers.monthly_income || 0);
  const housing = parseFloat(answers.housing || 0);
  const food = parseFloat(answers.food || 0);
  const transport = parseFloat(answers.transport || 0);
  const entertainment = parseFloat(answers.entertainment || 0);
  const savingsGoal = parseFloat(answers.savings_goal || 0);
  const financialGoal = answers.financial_goal || 'General Savings';

  const totalExpenses = housing + food + transport + entertainment;
  const balance = income - totalExpenses;
  const canAchieveSavings = balance >= savingsGoal;

  const pct = (x) => (income > 0 ? ((x / income) * 100).toFixed(1) : '0.0');

  return {
    income,
    expenses: {
      housing,
      food,
      transport,
      entertainment,
      total: totalExpenses,
    },
    savingsGoal,
    availableBalance: balance,
    canAchieveSavings,
    financialGoal,
    percentages: {
      housing: pct(housing),
      food: pct(food),
      transport: pct(transport),
      entertainment: pct(entertainment),
      savings: pct(savingsGoal),
    },
    recommendations: buildRecommendations(income, totalExpenses, savingsGoal, financialGoal),
  };
}

export default computeBudgetPlanFromAnswers;
