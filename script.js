const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector("#site-nav");

if (navToggle && siteNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

const conversationForm = document.querySelector("#conversation-form");
const formStatus = document.querySelector("#form-status");

if (conversationForm && formStatus) {
  conversationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    formStatus.textContent =
      "Thanks. This local preview is ready to connect to WFC Australia's preferred inbox or booking flow.";
  });
}
