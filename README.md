# Ultimate Bookmark Manager & Validator

A modern, high-performance Chrome Extension built with **Vite**, **React**, and **TypeScript** (Manifest V3). This tool dynamically traverses nested bookmark folder hierarchies, verifies URL statuses using optimized networking handshakes, respects custom domain/URL skiplists via context menus, and compiles detailed downloadable text reports.

---

## Features

- **Hierarchical Breadcrumbs**: Recursive folder-crawler that shows full nested folder paths (`Folder > Subfolder`) inside the UI dropdown.
- **Smarter Validation Loop**: Optimized network checking that attempts fast `HEAD` requests and seamlessly falls back to `GET` requests to bypass rigid server blocks.
- **Persistent Configurable Timeouts**: Dynamically adjustable float-point network timeouts saved securely to `chrome.storage.local`.
- **Context Menu Skiplisting**: Right-click anywhere on a live page or hyperlink to quickly skiplist specific URLs or entire domains from being scanned.
- **Automatic Report Delivery**: Generates and auto-downloads a timestamped `.txt` summary file upon validation loop completion.
- **Safe Structural Backups**: Moves broken links into a dedicated, dynamically allocated `Broken Bookmarks Quarantine` folder with a one-click purge utility.

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

If a bookmark is flagged as broken, it isn't deleted outright. It is appended to a staging array and cleanly moved via chrome.bookmarks.move into a review silo. The Empty Quarantine Folder safety utility uses backwards-loop iteration logic to safely delete nested configurations without breaking target indices.

## Known Issues and Limitations

### False positives (URLs detected as 'broken' when they actually work)

Many websites employ techniques to combat botting and DDoS attacks, and sadly some of these measures make it extremely difficult for well-meaning Chrome extensions
like this one to to their jobs. This is why the exension never deletes "broken" links directly, but moves them into the Broken Bookmarks Quarantine folder for you
to review. It is because of the potential for false positives that this extension provides a skiplist feature, allowing you to mark domains or specific URLs to skip when performing link validation. The drawback to this approach is that you might have URLs for those sites which actually are invalid/broken; but it's all we've got for now. While Chrome offers several ways to view and manipulate bookmarks, I've found the chrome://bookmarks page to be the fastest/most-responsive one for performing manual reviews of the Quarantine folder. (Examples of sites that can result in false positives: 4chan.org, newgrounds.com)

### False negatives (URLs NOT detected as broken when the content linked to is no longer present)

This is a more complicated problem. For most web sites, if you use a bookmark that points to content that's no longer available on the site your browser (or Chrome extension) receives an HTTP error code of 404, and often even receives a web page that goes into more detail about the problem. Some sites, however, don't behave that way- they return a successful HTTP code (200, for example) and they might display a human readable message that the content isn't available, or they might show some default index page- but from the extension's perspective, the pages loaded successfully and no errors were reported. This is a hard problem to fix, because each web site can potentially define its own behavior for this kind of situation, so it's difficult to write broken link detection logic that works across the board. Thankfully, these sites appear to be rate.
