// src/background.ts

let isValidationRunning = false;
let currentStatusMessage = 'Idle';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_VALIDATION') {
    const { folderId, folderPath } = message;

    if (!isValidationRunning) {
      runValidation(folderId, folderPath || folderId);
      sendResponse({ status: 'started' });
    } else {
      sendResponse({ status: 'already_running' });
    }
  }

  if (message.action === 'GET_STATUS') {
    sendResponse({
      isRunning: isValidationRunning,
      message: currentStatusMessage,
    });
  }

  if (message.action === 'PURGE_BROKEN_BOOKMARKS') {
    (async () => {
      try {
        const FOLDER_NAME = 'Broken Bookmarks Review';
        const existingFolders = await chrome.bookmarks.search({
          title: FOLDER_NAME,
        });

        if (existingFolders.length === 0) {
          sendResponse({
            success: false,
            message: 'Review folder does not exist.',
          });
          return;
        }

        const reviewFolderId = existingFolders[0].id;
        const subTree = await chrome.bookmarks.getSubTree(reviewFolderId);
        const children = subTree[0].children || [];

        if (children.length === 0) {
          sendResponse({ success: true, message: 'Folder is already empty.' });
          return;
        }

        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (child.url) {
            await chrome.bookmarks.remove(child.id);
          } else {
            await chrome.bookmarks.removeTree(child.id);
          }
        }

        console.log(
          `[PURGE] Successfully deleted ${children.length} bookmarks from the review folder.`
        );
        sendResponse({
          success: true,
          message: `Deleted ${children.length} bookmarks.`,
        });
      } catch (err: any) {
        console.error('[PURGE ERROR]', err);
        sendResponse({
          success: false,
          message: err.message || 'Purge failed.',
        });
      }
    })();
    return true;
  }

  // NEW: Folder Consolidation Engine
  if (message.action === 'CONSOLIDATE_FOLDERS') {
    (async () => {
      try {
        const { sourceId, targetId } = message;

        // Fetch static array child map list of source targets
        const subTree = await chrome.bookmarks.getSubTree(sourceId);
        const children = subTree[0].children || [];

        if (children.length === 0) {
          sendResponse({
            success: true,
            message: 'Source folder has no assets to move.',
          });
          return;
        }

        let movedCount = 0;
        // Map elements explicitly across via ID positions (index offsets safety guaranteed)
        for (const child of children) {
          try {
            await chrome.bookmarks.move(child.id, { parentId: targetId });
            movedCount++;
          } catch (moveErr) {
            console.error(
              `[CONSOLIDATE ERROR] Failed to transfer element node: ${child.id}`,
              moveErr
            );
          }
        }

        console.log(
          `[CONSOLIDATE] Shifted ${movedCount} elements out of node ${sourceId} into destination target ${targetId}.`
        );
        sendResponse({
          success: true,
          message: `Moved ${movedCount} bookmarks successfully.`,
        });
      } catch (err: any) {
        console.error('[CONSOLIDATE FATAL ERROR]', err);
        sendResponse({
          success: false,
          message: err.message || 'Consolidation loop failed.',
        });
      }
    })();
    return true; // Keep message channel bridge alive for async response mapping
  }

  return true;
});

// Create context menus together on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'whitelist-domain',
    title: 'Whitelist this domain',
    contexts: ['page', 'link'],
  });

  chrome.contextMenus.create({
    id: 'whitelist-url',
    title: 'Whitelist this URL',
    contexts: ['page', 'link'],
  });
});

// Handle Context Menu Clicks with Storage Persistence
chrome.contextMenus.onClicked.addListener(async (info) => {
  const urlString = info.linkUrl || info.pageUrl;
  if (!urlString) return;

  if (info.menuItemId === 'whitelist-domain') {
    try {
      const domain = new URL(urlString).hostname;
      const result = (await chrome.storage.local.get({
        whitelistedDomains: [],
      })) as { whitelistedDomains: string[] };
      const currentDomains: string[] = result.whitelistedDomains;

      if (!currentDomains.includes(domain)) {
        currentDomains.push(domain);
        await chrome.storage.local.set({ whitelistedDomains: currentDomains });
        console.log(`[WHITELIST] Successfully saved domain: ${domain}`);
      }
    } catch (e) {
      console.error('Failed to whitelist domain:', e);
    }
  } else if (info.menuItemId === 'whitelist-url') {
    try {
      const result = (await chrome.storage.local.get({
        whitelistedUrls: [],
      })) as { whitelistedUrls: string[] };
      const currentUrls: string[] = result.whitelistedUrls;

      if (!currentUrls.includes(urlString)) {
        currentUrls.push(urlString);
        await chrome.storage.local.set({ whitelistedUrls: currentUrls });
        console.log(`[WHITELIST] Successfully saved URL: ${urlString}`);
      }
    } catch (e) {
      console.error('Failed to whitelist URL:', e);
    }
  }
});

async function runValidation(folderId: string, folderPath: string) {
  isValidationRunning = true;
  currentStatusMessage = 'Fetching bookmarks...';

  const RULE_ID = 1;
  const fileLogLines: string[] = [];
  const logAndTrack = (text: string, isWarning = false) => {
    const timestamp = new Date().toISOString();
    fileLogLines.push(`[${timestamp}] ${text}`);
    if (isWarning) console.warn(text);
    else console.log(text);
  };

  logAndTrack(
    `[INIT] Starting validation for folder ID: ${folderId}, Folder Path: ${folderPath}`
  );

  try {
    // --- INJECT BROWSER USER-AGENT ---
    if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
      logAndTrack(
        `[CONFIG] Injecting Chrome Browser User-Agent ID to bypass bot filters.`
      );
      const realBrowserAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [RULE_ID],
        addRules: [
          {
            id: RULE_ID,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [
                {
                  header: 'user-agent',
                  operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                  value: realBrowserAgent,
                },
              ],
            },
            condition: {
              initiatorDomains: [chrome.runtime.id],
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
              ],
            },
          },
        ],
      });
    }

    // Load Settings and Whitelists from Storage
    let timeoutSecondsSetting: number | string = 5.0;
    let whitelistedDomains: string[] = [];
    let whitelistedUrls: string[] = [];

    try {
      const storage = (await chrome.storage.local.get({
        timeoutSeconds: 5.0,
        whitelistedDomains: [],
        whitelistedUrls: [],
      })) as {
        timeoutSeconds: number | string;
        whitelistedDomains: string[];
        whitelistedUrls: string[];
      };

      timeoutSecondsSetting = storage.timeoutSeconds;
      whitelistedDomains = storage.whitelistedDomains;
      whitelistedUrls = storage.whitelistedUrls;
    } catch (e) {
      // Storage unavailable fallbacks handled implicitly
    }

    const timeoutDurationMs =
      typeof timeoutSecondsSetting === 'number'
        ? timeoutSecondsSetting * 1000
        : parseFloat(timeoutSecondsSetting) * 1000;

    logAndTrack(
      `[CONFIG] Using timeout configuration: ${timeoutSecondsSetting}s`
    );
    logAndTrack(
      `[CONFIG] Loaded ${whitelistedDomains.length} domains and ${whitelistedUrls.length} URLs in whitelist.`
    );

    const subTree = await chrome.bookmarks.getSubTree(folderId);
    const bookmarkLinks = subTree[0].children?.filter((node) => node.url) || [];
    const total = bookmarkLinks.length;

    const failedBookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];

    for (let i = 0; i < total; i++) {
      const link = bookmarkLinks[i];
      if (!link.url) continue;

      const currentItemNumber = i + 1;
      currentStatusMessage = `Checking link ${currentItemNumber} of ${total}...`;

      // --- EVALUATE WHITELISTS BEFORE SCANNING ---
      let isWhitelisted = false;
      let whitelistReason = '';

      if (whitelistedUrls.includes(link.url)) {
        isWhitelisted = true;
        whitelistReason = 'Exact URL is whitelisted';
      } else {
        try {
          const currentDomain = new URL(link.url).hostname;
          if (whitelistedDomains.includes(currentDomain)) {
            isWhitelisted = true;
            whitelistReason = `Domain (${currentDomain}) is whitelisted`;
          }
        } catch (urlErr) {
          // Malformed bookmark URL safety catch
        }
      }

      if (isWhitelisted) {
        logAndTrack(
          `[SKIPPED] Item ${currentItemNumber}/${total} | Reason: ${whitelistReason} | URL: ${link.url}`
        );
        continue;
      }

      // --- PROCEED WITH NORMAL SCAN IF NOT WHITELISTED ---
      logAndTrack(
        `[CHECKING] Item ${currentItemNumber}/${total} | URL: ${link.url}`
      );

      let isBroken = false;
      let invalidationReason = '';

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          timeoutDurationMs
        );

        let response = await fetch(link.url, {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (
          response.status === 405 ||
          response.status === 403 ||
          response.status === 400
        ) {
          logAndTrack(`[FALLBACK] Retrying with GET for: ${link.url}`);
          const getController = new AbortController();
          const getTimeoutId = setTimeout(
            () => getController.abort(),
            timeoutDurationMs
          );

          response = await fetch(link.url, {
            method: 'GET',
            signal: getController.signal,
          });
          clearTimeout(getTimeoutId);
        }

        if (response.status >= 400) {
          isBroken = true;
          invalidationReason = `HTTP Error Status: ${response.status}`;
        }
      } catch (error: any) {
        isBroken = true;
        invalidationReason =
          error.name === 'AbortError'
            ? 'Timeout Stalled'
            : `Network/DNS Error (${error.message})`;
      }

      if (isBroken) {
        logAndTrack(
          `[INVALID] Reason: ${invalidationReason} | URL: ${link.url}`,
          true
        );
        failedBookmarks.push(link);
      } else {
        logAndTrack(`[VALID] Passed: ${link.url}`);
      }
    }

    if (failedBookmarks.length > 0) {
      currentStatusMessage = `Moving ${failedBookmarks.length} broken links...`;
      await moveFailedBookmarks(failedBookmarks);
      currentStatusMessage = `Completed! Moved ${failedBookmarks.length} broken links.`;
    } else {
      currentStatusMessage = 'Validation complete! All links are healthy.';
    }

    // --- TRIGGER FILE DOWNLOAD ---
    const fullLogText = fileLogLines.join('\n');
    const base64LogData = btoa(unescape(encodeURIComponent(fullLogText)));
    const finalDownloadUrl = `data:text/plain;charset=utf-8;base64,${base64LogData}`;

    if (typeof chrome !== 'undefined' && chrome.downloads) {
      await chrome.downloads.download({
        url: finalDownloadUrl,
        filename: 'bookmark-validator-report.txt',
        saveAs: false,
      });
    }
  } catch (err) {
    console.error('[FATAL ERROR] Exception in validation loop:', err);
    currentStatusMessage = 'An error occurred during validation.';
  } finally {
    // --- CLEAN UP DEE RULES ---
    if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [RULE_ID],
        });
        console.log(
          '[FINISHED] Cleared session User-Agent injection rules cleanly.'
        );
      } catch (e) {
        console.error('Failed to clean up net rules:', e);
      }
    }

    isValidationRunning = false;
    console.log(
      '[FINISHED] Background validation worker has returned to idle state.'
    );
  }
}

async function moveFailedBookmarks(
  failedNodes: chrome.bookmarks.BookmarkTreeNode[]
) {
  const FOLDER_NAME = 'Broken Bookmarks Review';
  const existingFolders = await chrome.bookmarks.search({ title: FOLDER_NAME });
  let reviewFolderId = '';

  if (existingFolders.length > 0) {
    reviewFolderId = existingFolders[0].id;
  } else {
    const rootNodes = await chrome.bookmarks.getTree();
    const primaryRootNode = rootNodes[0]?.children?.[0] || rootNodes[0];
    const safeParentId = primaryRootNode.id;

    console.log(
      `[SETUP] Creating review destination folder under safe root parent ID: ${safeParentId}`
    );

    const newFolder = await chrome.bookmarks.create({
      title: FOLDER_NAME,
      parentId: safeParentId,
    });
    reviewFolderId = newFolder.id;
  }

  for (const node of failedNodes) {
    try {
      await chrome.bookmarks.move(node.id, { parentId: reviewFolderId });
    } catch (e) {
      console.error(`Failed to move bookmark ${node.id}:`, e);
    }
  }
}
