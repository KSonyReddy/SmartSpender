// Dashboard page functionality
document.addEventListener("DOMContentLoaded", function () {
  // Load budget data
  loadBudgetData();
});

function loadBudgetData() {
  fetch("/api/budget")
    .then((response) => response.json())
    .then((data) => {
      document.getElementById("totalBudget").textContent =
        data.totalBudget || "$5,000.00";
      document.getElementById("spent").textContent = data.spent || "$2,500.00";
      document.getElementById("remaining").textContent =
        data.remaining || "$2,500.00";
    })
    .catch((error) => {
      console.error("Error fetching budget data:", error);
      document.getElementById("totalBudget").textContent = "$5,000.00";
      document.getElementById("spent").textContent = "$2,500.00";
      document.getElementById("remaining").textContent = "$2,500.00";
    });
}
