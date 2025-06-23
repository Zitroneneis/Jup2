## Copilot Instructions

This file provides hints to GitHub Copilot about the technology and styling used in this project to help it generate more relevant suggestions.

### Technology Stack

*   **Frontend:**
    *   Plain HTML, CSS, and JavaScript.
    *   No complex frameworks like React, Angular, or Vue.js are used in the main `chat.html`.
*   **JavaScript Libraries:**
    *   **`marked`**: For parsing Markdown formatted text and converting it to HTML.
    *   **`DOMPurify`**: For sanitizing HTML to prevent Cross-Site Scripting (XSS) vulnerabilities.
    *   **`Prism.js`**: For syntax highlighting of code blocks.
    *   **`lottie-web`**: For rendering Lottie animations (e.g., the "thinking" indicator).
*   **APIs & Services:**
    *   The application communicates with a backend proxy (`api/gemini-proxy.js`) to interact with a Large Language Model (likely Google's Gemini).
    *   **Google Recaptcha v3** is used for security to prevent bots.
*   **JupyterLite:**
    *   The project includes `jupyter-lite`, which is a lightweight version of JupyterLab that runs entirely in the web browser. This is used for the `.ipynb` notebook files.
*   **Deployment:**
    *   The application is deployed on **Vercel**.
    *   There is an automated build pipeline that triggers when the repository is pushed to GitHub.
    *   Environment variables are managed through Vercel's dashboard.

### Styling

*   **CSS:**
    *   Styling is primarily done using a `<style>` block within the `chat.html` file.
    *   It uses modern CSS properties like Flexbox for layout.
*   **Design:**
    *   The UI is a clean, modern chat interface.
    *   User messages are styled in blue, and bot messages are in a light gray.
    *   Code snippets have syntax highlighting.
    *   A lightbox is implemented to view generated images.
*   **No CSS Frameworks:**
    *   CSS frameworks like Bootstrap or Tailwind CSS are not used. All styles are custom.

### General Guidance for Copilot

*   When generating code, please adhere to the existing style and patterns.
*   For JavaScript, use modern ES6+ syntax where appropriate.
*   Ensure that any generated HTML is properly sanitized before being added to the DOM to maintain security.
*   When adding new features, try to use the existing libraries and components.
