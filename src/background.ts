// src/background.ts

let isValidationRunning = false;
let currentStatusMessage = 'Idle';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_VALIDATION') {
    const { folderId } = message;

    if (!isValidationRunning) {
      runValidation(folderId);
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
  return true;
});

async function runValidation(folderId: string) {
  isValidationRunning = true;
  currentStatusMessage = 'Fetching bookmarks...';

  const fileLogLines: string[] = [];
  const logAndTrack = (text: string, isWarning = false) => {
    const timestamp = new Date().toISOString();
    const formattedLine = `[${timestamp}] ${text}`;
    fileLogLines.push(formattedLine);

    if (isWarning) console.warn(text);
    else console.log(text);
  };

  logAndTrack(`[INIT] Starting validation for folder ID: ${folderId}`);

  try {
    let timeoutSecondsSetting: number | string = 5.0;
    try {
      const storage = (await chrome.storage.local.get('timeoutSeconds')) as {
        timeoutSeconds?: number | string;
      };
      if (storage.timeoutSeconds !== undefined)
        timeoutSecondsSetting = storage.timeoutSeconds;
    } catch (e) {
      // Storage unavailable fallback handled implicitly
    }

    const timeoutDurationMs =
      typeof timeoutSecondsSetting === 'number'
        ? timeoutSecondsSetting * 1000
        : parseFloat(timeoutSecondsSetting) * 1000;

    logAndTrack(
      `[CONFIG] Using timeout configuration: ${timeoutSecondsSetting}s`
    );

    const subTree = await chrome.bookmarks.getSubTree(folderId);
    const bookmarkLinks = subTree[0].children?.filter((node) => node.url) || [];
    const total = bookmarkLinks.length;

    // --- CRITICAL FIX: The missing declaration array ---
    const failedBookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];

    for (let i = 0; i < total; i++) {
      const link = bookmarkLinks[i];
      if (!link.url) continue;

      const currentItemNumber = i + 1;
      currentStatusMessage = `Checking link ${currentItemNumber} of ${total}...`;
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
          mode: 'no-cors',
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
            mode: 'no-cors',
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
    const newFolder = await chrome.bookmarks.create({
      title: FOLDER_NAME,
      parentId: '2',
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
