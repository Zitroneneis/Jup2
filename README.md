# Jup2: Embedded JupyterLite + Chat Demo

This repository contains a demo platform that embeds JupyterLite notebooks and provides chat interfaces backed by (1) Google Gemini Flash via a serverless proxy and (2) the Perplexity API via a React demo.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [Usage](#usage)
  - [Main Demo (`index.html`)](#main-demo-indexhtml)
  - [Floating Chat Prototype (`prototype2.html`)](#floating-chat-prototype-prototype2html)
  - [Perplexity Chat Demo (`chatdemo.js`)](#perplexity-chat-demo-chatdemoj)
- [API Reference](#api-reference)
- [Assets](#assets)
- [Lite Build (`/lite`)](#lite-build-lite)
- [Notebooks](#notebooks)
- [License](#license)

---

## Overview

Jup2 showcases an interactive learning environment that combines:

- **Embedded JupyterLite** notebooks for teaching and exploration
- **Chat interface** powered by Google Gemini Flash 2.0 (via `api/gemini-proxy.js`)
- **Perplexity LLM** React chat demo (`chatdemo.js`)
- **Floating chat prototype** (`prototype2.html`)

Students and teachers can follow lessons, ask questions in natural language, and receive live feedback or guidance.

## Features

- **JupyterLite Embedding**: Load any Notebook by URL or via the built-in DemoBook/Lesson files.
- **Gemini Chat**: Conversational interface with typing animation and stop button; proxy handles API key and request formatting.
- **Floating Chat**: Standalone floating widget for on-page assistance (`prototype2.html`).
- **Perplexity Chat Demo**: React component (`chatdemo.js`) connecting to Perplexity API for quick sentiment and answer demos.
- **Markdown Rendering**: Bot responses are rendered with [marked.js](https://github.com/markedjs/marked) and sanitized by [DOMPurify](https://github.com/cure53/DOMPurify).
- **Lottie Animations**: Thinking animation during response generation.

## Project Structure

```
/ (root)
├─ api/                    # Serverless proxy for Gemini API
│  └─ gemini-proxy.js      # POST /api/gemini-proxy handler
├─ assets/                 # Static assets (animations, icons)
├─ chatdemo.js             # React Perplexity chat demo
├─ index.html              # Main embedded notebook + Gemini chat demo
├─ prototype2.html         # Floating chat widget demo
├─ project.html            # Static info page
├─ OLDindex.html           # Previous version of main page
├─ package.json            # Dependencies (ai, openai)
├─ jupyter_lite_config.json# Config for local JupyterLite build
├─ lite/                   # Self-hosted JupyterLite distribution
├─ *.ipynb                 # Demo notebooks (Lesson.ipynb, DemoBook.ipynb, d2.ipynb)
└─ README.md               # <-- You are here
```

## Getting Started

### Prerequisites

- Node.js (>=14.x)
- `npm` or `yarn`
- (Optional) Vercel CLI for local serverless emulation

### Installation

```bash
# From project root
git clone <repo-url> jup2-demo
cd jup2-demo
npm install
# or
yarn install
```

### Environment Variables

Create a `.env.local` (for Vercel) or set in your shell:

```bash
export GEMINI_API_KEY=your_google_gemini_api_key
export NEXT_PUBLIC_PERPLEXITY_API_KEY=your_perplexity_key
export NEXT_PUBLIC_PERPLEXITY_API_ENDPOINT=https://api.perplexity.ai/...
```

### Running Locally

#### Using Vercel CLI (recommended)

```bash
npm install -g vercel
vercel dev
```

This will serve `index.html`, static assets, and `/api/gemini-proxy` endpoint.

#### Static Preview

If you only need the front-end demo (no Gemini chat), you can serve files statically:

```bash
npm install -g serve
serve .
```

Navigate to `http://localhost:3000` (default) and open `index.html`.

## Usage

### Main Demo (`index.html`)

- Left panel: Embedded JupyterLite Notebook.
- Right panel: Chat widget using Google Gemini Flash 2.0.
- Type a message, press **Send**; watch a Lottie animation while the model generates.
- **Stop Generating** button cancels streaming and removes partial content.

### Floating Chat Prototype (`prototype2.html`)

- A standalone chat window that floats above any page.
- Useful for minimal UI integration.

### Perplexity Chat Demo (`chatdemo.js`)

- React component showing side-by-side instructions and chat.
- Uses environment variables:
  - `NEXT_PUBLIC_PERPLEXITY_API_KEY`
  - `NEXT_PUBLIC_PERPLEXITY_API_ENDPOINT`

## API Reference

### `api/gemini-proxy.js`

Handles `POST /api/gemini-proxy` with payload:

```json
{
  "history": [ { role: "user"|"model", parts: [ { text: string } ] }, ... ]
}
```

- Validates method, API key, and history.
- Crafts request to Google Gemini REST endpoint.
- Returns raw Gemini response JSON or formatted error.

## Assets

- `assets/thinking.lottie` & `assets/thinking.gif` for loading animations.
- Icons and images in root (`BongoBMO.gif`, `WhatIsAI.png`).

## Lite Build (`/lite`)

Self-hosted distribution of JupyterLite including:

- `lite/index.html` + service worker for offline notebooks
- Prebuilt JS bundles in `lite/build/`
- Configuration and manifest for PWA support

## Notebooks

- `DemoBook.ipynb` & `Lesson.ipynb`: Pre-authored lessons.
- `d2.ipynb`: Interactive demo lesson.
- Use Notebook menu: **Open from URL...** to load external `.ipynb` URLs.

## License

MIT © Your Name
