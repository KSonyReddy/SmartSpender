// Chat page functionality
document.addEventListener("DOMContentLoaded", function () {
  const messageInput = document.getElementById("messageInput");
  const sendButton = document.getElementById("sendButton");
  const chatMessages = document.getElementById("chatMessages");

  sendButton.addEventListener("click", function () {
    const message = messageInput.value.trim();
    if (message) {
      // Add user message to chat
      const userMessage = document.createElement("div");
      userMessage.className = "message user-message";
      userMessage.textContent = message;
      chatMessages.appendChild(userMessage);

      messageInput.value = "";
      messageInput.focus();

      // Send message to backend
      fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ message: message }),
      })
        .then((response) => response.json())
        .then((data) => {
          const botMessage = document.createElement("div");
          botMessage.className = "message bot-message";
          botMessage.textContent =
            data.reply || data.message || "Sorry, I did not understand that.";
          chatMessages.appendChild(botMessage);
        })
        .catch((error) => {
          console.error("Error sending message:", error);
          const errorMessage = document.createElement("div");
          errorMessage.className = "message error-message";
          errorMessage.textContent = "Error communicating with server.";
          chatMessages.appendChild(errorMessage);
        });
    }
  });

  messageInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      sendButton.click();
    }
  });
});
