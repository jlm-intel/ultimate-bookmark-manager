// src/background.ts
const IDLE_STRING = 'Idle';
const QUARANTINE_FOLDER_NAME = 'Broken Bookmarks Quarantine';
let isValidationRunning = false;
let currentStatusMessage = IDLE_STRING;
let currentCompletionMessage = '';

async function debugLog(message: string, ...optionalParams: any[]) {
  try {
    const { isDebugLoggingEnabled } = await chrome.storage.local.get({
      isDebugLoggingEnabled: false,
    });
    if (isDebugLoggingEnabled) {
      console.log(message, ...optionalParams);
    }
  } catch (e) {
    // Fail silently if storage is unavailable
  }
}

async function debugWarn(message: string, ...optionalParams: any[]) {
  try {
    const { isDebugLoggingEnabled } = await chrome.storage.local.get({
      isDebugLoggingEnabled: false,
    });
    if (isDebugLoggingEnabled) {
      console.warn(message, ...optionalParams);
    }
  } catch (e) {
    // Fail silently if storage is unavailable
  }
}

async function debugError(message: string, ...optionalParams: any[]) {
  try {
    const { isDebugLoggingEnabled } = await chrome.storage.local.get({
      isDebugLoggingEnabled: false,
    });
    if (isDebugLoggingEnabled) {
      console.error(message, ...optionalParams);
    }
  } catch (e) {
    // Fail silently if storage is unavailable
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_VALIDATION') {
    const { folderId, folderPath } = message;

    if (!isValidationRunning) {
      runValidation(folderId, folderPath || folderId);
      sendResponse({ status: 'started' }); // not currently handled in the UI
    } else {
      sendResponse({ status: 'already_running' }); // not currently handled in the UI
    }
  }

  if (message.action === 'GET_STATUS') {
    // popup sends this message every second as long as the popup is visible. idle state is currently only
    // managed for link validation, while other operations happen quickly enough that we don't lock the
    // UI for them at this time. 'message' is just the state of the validation process, while 'completion'
    // is a one-time message that is sent when the validation process finishes, so that the UI can display
    // a final message to the user.
    sendResponse({
      isRunning: isValidationRunning,
      message: currentStatusMessage,
      completion: currentCompletionMessage,
    });
    // completion messages are only sent once, to keep from overwriting the UI with stale data.
    if (currentCompletionMessage.length > 0) {
      currentCompletionMessage = '';
    }
  }

  if (message.action === 'PURGE_BROKEN_BOOKMARKS') {
    (async () => {
      try {
        // only purge the quarantine folder, if it exists. If it doesn't exist, return a message to the user.
        const existingFolders = await chrome.bookmarks.search({
          title: QUARANTINE_FOLDER_NAME,
        });

        if (existingFolders.length === 0) {
          sendResponse({
            success: false,
            completion: 'Quarantine folder does not exist.',
          });
          return;
        }

        // this operation performs a bottom-up deletion of all bookmarks and subfolders in the quarantine folder, leaving the folder itself intact.
        const reviewFolderId = existingFolders[0].id;
        const subTree = await chrome.bookmarks.getSubTree(reviewFolderId);
        const children = subTree[0].children || [];

        if (children.length === 0) {
          sendResponse({
            success: true,
            completion: 'Folder is already empty.',
          });
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

        debugLog(
          `[PURGE] Successfully deleted ${children.length} bookmarks from the quarantine folder.`
        );
        sendResponse({
          success: true,
          completion: `Deleted ${children.length} bookmarks.`,
        });
      } catch (err: any) {
        debugError('[PURGE ERROR]', err);
        sendResponse({
          success: false,
          completion: err.message || 'Purge failed.',
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

        // Fetch the tree slice for the source folder
        const subTree = await chrome.bookmarks.getSubTree(sourceId);

        // This operation only moves root-level bookmarks, not subfolders or nested bookmarks. This is intentional.
        const bookmarkChildren =
          subTree[0].children?.filter((node) => node.url) || [];

        if (bookmarkChildren.length === 0) {
          sendResponse({
            success: true,
            completion: 'Source folder has no root-level bookmarks to move.',
          });
          return;
        }

        let movedCount = 0;
        let movedErrors = 0;
        // Iterate exclusively through the bookmark nodes
        for (const child of bookmarkChildren) {
          try {
            await chrome.bookmarks.move(child.id, { parentId: targetId });
            movedCount++;
          } catch (moveErr) {
            debugError(
              `[CONSOLIDATE ERROR] Failed to transfer element node: ${child.id}`,
              moveErr
            );
            movedErrors++;
          }
        }

        debugLog(
          `[CONSOLIDATE] Shifted ${movedCount} direct bookmarks out of node ${sourceId} into destination target ${targetId}.`
        );
        sendResponse({
          success: true,
          completion: `Moved ${movedCount} bookmarks successfully with ${movedErrors} errors.`,
        });
      } catch (err: any) {
        debugError('[CONSOLIDATE FATAL ERROR]', err);
        sendResponse({
          success: false,
          completion: err.message || 'Consolidation loop failed.',
        });
      }
    })();
    return true; // Keep message channel bridge alive for async response mapping
  }

  if (message.action === 'CLEAN_EMPTY_FOLDERS') {
    (async () => {
      try {
        const tree = await chrome.bookmarks.getTree();
        let deletedCount = 0;

        // Bottom-up post-order traversal function
        async function traverseAndPurge(
          node: chrome.bookmarks.BookmarkTreeNode
        ): Promise<boolean> {
          // If it's a bookmark (has a URL), it contains a valid item
          if (node.url) return true;

          // If it's a folder, inspect its children first
          if (node.children) {
            let hasValidContents = false;

            // Process children sequentially
            for (const child of node.children) {
              const childHasContents = await traverseAndPurge(child);
              if (childHasContents) {
                hasValidContents = true;
              }
            }

            // Guard against deleting permanent system roots (Root '0', Bookmarks Bar '1', Other '2', etc.)
            const isSystemNode =
              node.id === '0' || node.id === '1' || node.id === '2';

            if (!hasValidContents && !isSystemNode && node.id) {
              try {
                await chrome.bookmarks.remove(node.id);
                deletedCount++;
                return false; // Node is gone, it contributes nothing to its parent anymore
              } catch (err) {
                debugError(
                  `[CLEAN ERROR] Could not remove folder ${node.id}:`,
                  err
                );
                return true; // Treat as containing contents if deletion fails
              }
            }

            return hasValidContents;
          }
          return false;
        }

        // Run the structural sweep across the root nodes
        for (const root of tree) {
          await traverseAndPurge(root);
        }

        debugLog(
          `[CLEAN COMPLETE] Purged ${deletedCount} empty folders recursively.`
        );
        sendResponse({
          success: true,
          completion: `Purged ${deletedCount} empty folders.`,
        });
      } catch (err: any) {
        debugError('[CLEAN FATAL ERROR]', err);
        sendResponse({
          success: false,
          completion: err.message || 'Folder clean cycle failed.',
        });
      }
    })();
    return true; // Keep message bridge open for async processing
  }

  return true;
});

// Create context menus together on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'skiplist-domain',
    title: 'Skip this whole site when validating bookmarks',
    contexts: ['page', 'link'],
  });

  chrome.contextMenus.create({
    id: 'skiplist-url',
    title: 'Skip this specific page when validating bookmarks',
    contexts: ['page', 'link'],
  });
});

// Handle Context Menu Clicks with Storage Persistence
chrome.contextMenus.onClicked.addListener(async (info) => {
  const urlString = info.linkUrl || info.pageUrl;
  if (!urlString) return;

  if (info.menuItemId === 'skiplist-domain') {
    try {
      const domain = new URL(urlString).hostname;
      const result = (await chrome.storage.local.get({
        skiplistedDomains: [],
      })) as { skiplistedDomains: string[] };
      const currentDomains: string[] = result.skiplistedDomains;

      if (!currentDomains.includes(domain)) {
        currentDomains.push(domain);
        await chrome.storage.local.set({ skiplistedDomains: currentDomains });
        debugLog(`[WHITELIST] Successfully saved domain: ${domain}`);
      }
    } catch (e) {
      debugError('Failed to skiplist domain:', e);
    }
  } else if (info.menuItemId === 'skiplist-url') {
    try {
      const result = (await chrome.storage.local.get({
        skiplistedUrls: [],
      })) as { skiplistedUrls: string[] };
      const currentUrls: string[] = result.skiplistedUrls;

      if (!currentUrls.includes(urlString)) {
        currentUrls.push(urlString);
        await chrome.storage.local.set({ skiplistedUrls: currentUrls });
        debugLog(`[WHITELIST] Successfully saved URL: ${urlString}`);
      }
    } catch (e) {
      debugError('Failed to skiplist URL:', e);
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
    if (isWarning) debugWarn(text);
    else debugLog(text);
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

    // Load Settings and Skiplists from Storage
    let timeoutSecondsSetting: number | string = 5.0;
    let skiplistedDomains: string[] = [];
    let skiplistedUrls: string[] = [];

    try {
      const storage = (await chrome.storage.local.get({
        timeoutSeconds: 5.0,
        skiplistedDomains: [],
        skiplistedUrls: [],
      })) as {
        timeoutSeconds: number | string;
        skiplistedDomains: string[];
        skiplistedUrls: string[];
      };

      timeoutSecondsSetting = storage.timeoutSeconds;
      skiplistedDomains = storage.skiplistedDomains;
      skiplistedUrls = storage.skiplistedUrls;
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
      `[CONFIG] Loaded ${skiplistedDomains.length} domains and ${skiplistedUrls.length} URLs in skiplist.`
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
      let isSkiplisted = false;
      let skiplistReason = '';

      if (skiplistedUrls.includes(link.url)) {
        isSkiplisted = true;
        skiplistReason = 'Exact URL is skiplisted';
      } else {
        try {
          const currentDomain = new URL(link.url).hostname;
          if (skiplistedDomains.includes(currentDomain)) {
            isSkiplisted = true;
            skiplistReason = `Domain (${currentDomain}) is skiplisted`;
          }
        } catch (urlErr) {
          // Malformed bookmark URL safety catch
        }
      }

      if (isSkiplisted) {
        logAndTrack(
          `[SKIPPED] Item ${currentItemNumber}/${total} | Reason: ${skiplistReason} | URL: ${link.url}`
        );
        continue;
      }

      // --- PROCEED WITH NORMAL SCAN IF NOT WHITELISTED ---
      logAndTrack(
        `[CHECKING] Item ${currentItemNumber}/${total} | URL: ${link.url}`
      );

      let isBroken = false;
      let invalidationReason = '';
      let response: Response | null = null; // 1. Scope the live response object to the entire iteration step

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          timeoutDurationMs
        );

        // 2. Remove "let" so it updates our wider scoped variable
        response = await fetch(link.url, {
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

          // Remove "let" here as well so the fallback updates the same reference
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

      // 3. Your log code can now cleanly read the live object safely!
      const finalHttpCode = response ? response.status : 0;

      if (isBroken) {
        logAndTrack(
          `[INVALID] HTTP Code ${finalHttpCode} | Reason: ${invalidationReason} | URL: ${link.url}`,
          true
        );
        failedBookmarks.push(link);
      } else {
        logAndTrack(`[VALID] HTTP Code ${finalHttpCode} | URL: ${link.url}`);
      }
    }

    if (failedBookmarks.length > 0) {
      currentStatusMessage = `Moving ${failedBookmarks.length} broken links...`;
      await moveFailedBookmarks(failedBookmarks);
      currentCompletionMessage = `Completed! Moved ${failedBookmarks.length} broken links.`;
    } else {
      currentCompletionMessage = 'Validation complete! All links are healthy.';
    }
    currentStatusMessage = IDLE_STRING;

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
    debugError('[FATAL ERROR] Exception in validation loop:', err);
    currentCompletionMessage = 'An error occurred during validation.';
    currentStatusMessage = IDLE_STRING;
  } finally {
    // --- CLEAN UP DEE RULES ---
    if (typeof chrome !== 'undefined' && chrome.declarativeNetRequest) {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [RULE_ID],
        });
        debugLog(
          '[FINISHED] Cleared session User-Agent injection rules cleanly.'
        );
      } catch (e) {
        debugError('Failed to clean up net rules:', e);
      }
    }

    isValidationRunning = false;
    debugLog(
      '[FINISHED] Background validation worker has returned to idle state.'
    );
  }
}

async function moveFailedBookmarks(
  failedNodes: chrome.bookmarks.BookmarkTreeNode[]
) {
  const existingFolders = await chrome.bookmarks.search({
    title: QUARANTINE_FOLDER_NAME,
  });
  let reviewFolderId = '';

  if (existingFolders.length > 0) {
    reviewFolderId = existingFolders[0].id;
  } else {
    const rootNodes = await chrome.bookmarks.getTree();

    // --- UPDATED: Targets index 1 (Other Bookmarks) with index 0 (Bookmarks Bar) as safety fallback ---
    const primaryRootNode =
      rootNodes[0]?.children?.[1] ||
      rootNodes[0]?.children?.[0] ||
      rootNodes[0];
    const safeParentId = primaryRootNode.id;

    debugLog(
      `[SETUP] Creating quarantine destination folder under safe root parent ID: ${safeParentId}`
    );

    const newFolder = await chrome.bookmarks.create({
      title: QUARANTINE_FOLDER_NAME,
      parentId: safeParentId,
    });
    reviewFolderId = newFolder.id;
  }

  for (const node of failedNodes) {
    try {
      await chrome.bookmarks.move(node.id, { parentId: reviewFolderId });
    } catch (e) {
      debugError(`Failed to move bookmark ${node.id}:`, e);
    }
  }
}
