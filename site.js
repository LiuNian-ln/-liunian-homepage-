// ---------- Footer year ----------
document.getElementById("year").textContent = new Date().getFullYear();

// ---------- Mobile nav toggle ----------
const navToggle = document.getElementById("nav-toggle");
const navLinks = document.getElementById("nav-links");

navToggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

navLinks.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

// ---------- Projects: fetched from /api/projects ----------
// Fallback shown if the API can't be reached (e.g. the page was opened
// directly from disk instead of through the running Drogon server).
const FALLBACK_PROJECTS = [
  {
    title: "Homepage Backend",
    description:
      "This very site: a C++ HTTP server built on Drogon, with a SQLite-backed contact form and project list.",
    tags: ["C++", "Drogon", "SQLite", "CMake"],
    link: "https://github.com/yourname",
  },
  {
    title: "Project Two",
    description: "Short description of a second project goes here.",
    tags: ["C++", "Linux"],
    link: "https://github.com/yourname",
  },
  {
    title: "Project Three",
    description: "Short description of a third project goes here.",
    tags: ["Python", "Tools"],
    link: "https://github.com/yourname",
  },
];

function renderProjects(projects, usingFallback) {
  const grid = document.getElementById("project-grid");
  grid.innerHTML = "";

  if (usingFallback) {
    const note = document.createElement("p");
    note.className = "project-status";
    note.textContent =
      "Showing sample data — start the server to load live projects from SQLite.";
    grid.appendChild(note);
  }

  projects.forEach((project) => {
    const card = document.createElement("article");
    card.className = "project-card";

    const title = document.createElement("h3");
    title.textContent = project.title;

    const desc = document.createElement("p");
    desc.textContent = project.description;

    const tagRow = document.createElement("div");
    tagRow.className = "project-tags";
    (project.tags || []).forEach((tag) => {
      const span = document.createElement("span");
      span.className = "project-tag";
      span.textContent = tag;
      tagRow.appendChild(span);
    });

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(tagRow);

    if (project.link) {
      const link = document.createElement("a");
      link.className = "project-link";
      link.href = project.link;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "View project →";
      card.appendChild(link);
    }

    grid.appendChild(card);
  });
}

async function loadProjects() {
  try {
    const res = await fetch("/api/projects");
    if (!res.ok) throw new Error("Bad response");
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error("Empty");
    renderProjects(data, false);
  } catch (err) {
    renderProjects(FALLBACK_PROJECTS, true);
  }
}

loadProjects();

// ---------- Contact form ----------
const contactForm = document.getElementById("contact-form");
const contactStatus = document.getElementById("cf-status");
const contactSubmit = document.getElementById("cf-submit");

contactForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    name: document.getElementById("cf-name").value.trim(),
    email: document.getElementById("cf-email").value.trim(),
    message: document.getElementById("cf-message").value.trim(),
  };

  contactStatus.className = "form-status";
  contactStatus.textContent = "";
  contactSubmit.disabled = true;
  contactSubmit.textContent = "Sending…";

  try {
    const res = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok && data.success) {
      contactStatus.textContent = "Message sent — thanks for reaching out!";
      contactStatus.className = "form-status is-success";
      contactForm.reset();
    } else {
      contactStatus.textContent = data.error || "Something went wrong. Please try again.";
      contactStatus.className = "form-status is-error";
    }
  } catch (err) {
    contactStatus.textContent =
      "Couldn't reach the server. Make sure liunian_homepage is running.";
    contactStatus.className = "form-status is-error";
  } finally {
    contactSubmit.disabled = false;
    contactSubmit.textContent = "Send message";
  }
});
