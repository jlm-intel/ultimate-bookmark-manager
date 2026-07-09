# Ultimate Bookmark Manager & Validator

A modern, high-performance Chrome Extension built with **Vite**, **React**, and **TypeScript** (Manifest V3). This tool dynamically traverses nested bookmark folder hierarchies, verifies URL statuses using optimized networking handshakes, respects custom domain/URL whitelists via context menus, and compiles detailed downloadable text reports.

---

## Features

- **Hierarchical Breadcrumbs**: Recursive folder-crawler that shows full nested folder paths (`Folder > Subfolder`) inside the UI dropdown.
- **Smarter Validation Loop**: Optimized network checking that attempts fast `HEAD` requests and seamlessly falls back to `GET` requests to bypass rigid server blocks.
- **Persistent Configurable Timeouts**: Dynamically adjustable float-point network timeouts saved securely to `chrome.storage.local`.
- **Context Menu Whitelisting**: Right-click anywhere on a live page or hyperlink to quickly whitelist specific URLs or entire domains from being scanned.
- **Automatic Report Delivery**: Generates and auto-downloads a timestamped `.txt` summary file upon validation loop completion.
- **Safe Structural Backups**: Moves broken links into a dedicated, dynamically allocated `Broken Bookmarks Review` folder with a one-click purge utility.

---

## Tech Stack

- **Framework:** React 18
- **Build Tool:** Vite
- **Language:** TypeScript
- **API Framework:** Chrome Extensions API (Manifest V3)

---

## Getting Started

### 1. Installation & Setup

Clone the repository and install the development dependencies:

```bash
npm install
```

### 2. Run the Development Build

Compile the extension and start the asset-watching process:

```bash
npm run build
```

This generates a compiled, production-ready extension package inside the dist/ directory.

### 3. Load the Extension into Google Chrome

Open Google Chrome and navigate to chrome://extensions/.

Enable Developer mode via the toggle switch in the top-right corner.

Click the Load unpacked button in the top-left corner.

Select the dist folder located inside this project's root directory.

Important Permission Note: Whenever you modify foundational security declarations inside public/manifest.json (such as adding host_permissions or declarativeNetRequest), you must completely Remove the extension from chrome://extensions/ and click Load Unpacked fresh to force Chrome to re-authorize the background Service Worker thread.

## Project Structure

```
├── dist/ # Production bundle injected into Chrome
├── public/
│ └── manifest.json # Extension configuration, scopes, & permissions
├── src/
│ ├── background.ts # Ephemeral MV3 Service Worker & background loop
│ ├── App.tsx # Popup user interface & React lifecycle hooks
│ ├── App.css # Scoped UI styles & custom layouts
│ └── main.tsx # React DOM root mounting point
├── package.json # Scripts and asset dependencies
└── tsconfig.json # TypeScript compiler configurations
```

## How It Works Behind the Scenes

### Bypassing Bot Firewalls

The background service worker utilizes the chrome.declarativeNetRequest API to dynamically inject a authentic desktop User-Agent string into outbound extension network traffic. This dramatically reduces false positives triggered by Cloudflare, Akamai, or strict server firewalls.

### Safe Invalidation Lifecycles

If a bookmark is flagged as broken, it isn't deleted outright. It is appended to a staging array and cleanly moved via chrome.bookmarks.move into a review silo. The Empty Review Folder safety utility uses backwards-loop iteration logic to safely delete nested configurations without breaking target indices.
