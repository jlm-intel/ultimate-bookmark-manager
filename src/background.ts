// src/background.ts

// Global state in the service worker (exists as long as the worker is awake)
let isValidationRunning = false;
let currentStatusMessage = 'Idle';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'START_VALIDATION') {
    const { folderId } = message;

    // Only start if not already running
    if (!isValidationRunning) {
      runValidation(folderId);
      sendResponse({ status: 'started' });
    } else {
      sendResponse({ status: 'already_running' });
    }
  }

  if (message.action === 'GET_STATUS') {
    // Send the current execution state back to the popup UI
    sendResponse({
      isRunning: isValidationRunning,
      message: currentStatusMessage,
    });
  }
  return true;
});

// src/background.ts

async function runValidation(folderId: string) {
  isValidationRunning = true;
  currentStatusMessage = 'Fetching bookmarks...';

  try {
    let timeoutSecondsSetting: number | string = 5.0;

    // Direct fetch with error catching - no rigid 'if' environment checks needed here!
    try {
      const storage = (await chrome.storage.local.get('timeoutSeconds')) as {
        timeoutSeconds?: number | string;
      };
      if (storage.timeoutSeconds !== undefined) {
        timeoutSecondsSetting = storage.timeoutSeconds;
      }
    } catch (storageError) {
      console.log(
        '[STORAGE NOTICE] Could not read from chrome.storage, using fallback default.',
        storageError
      );
    }

    // 2. Safe parsing implementation
    const timeoutDurationMs =
      typeof timeoutSecondsSetting === 'number'
        ? timeoutSecondsSetting * 1000
        : parseFloat(timeoutSecondsSetting) * 1000;

    console.log(
      `[INIT] Using timeout duration: ${timeoutSecondsSetting}s (${timeoutDurationMs}ms)`
    );

    // ... rest of your code (fetching subtree, loop, etc.) ...
    // ... rest of your code ...
    const subTree = await chrome.bookmarks.getSubTree(folderId);
    const bookmarkLinks = subTree[0].children?.filter((node) => node.url) || [];

    if (bookmarkLinks.length === 0) {
      currentStatusMessage = 'No links found to validate.';
      isValidationRunning = false;
      return;
    }

    const failedBookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];
    const total = bookmarkLinks.length;

    for (let i = 0; i < total; i++) {
      const link = bookmarkLinks[i];
      if (!link.url) continue;

      const currentItemNumber = i + 1;
      currentStatusMessage = `Checking link ${currentItemNumber} of ${total}...`;

      try {
        const controller = new AbortController();
        // 2. Apply the dynamic timeout duration variable here
        const timeoutId = setTimeout(
          () => controller.abort(),
          timeoutDurationMs
        );

        const response = await fetch(link.url, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status >= 400) {
          failedBookmarks.push(link);
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.error(
            `[TIMEOUT ALERT] Item ${currentItemNumber}/${total} stalled past ${timeoutSecondsSetting}s! URL: ${link.url}`
          );
        } else {
          failedBookmarks.push(link);
        }
      }
    }

    // Moving failed logic continues down here...
    if (failedBookmarks.length > 0) {
      currentStatusMessage = `Moving ${failedBookmarks.length} broken links...`;
      await moveFailedBookmarks(failedBookmarks);
      currentStatusMessage = `Completed! Moved ${failedBookmarks.length} broken links.`;
    } else {
      currentStatusMessage = 'Validation complete! All links are healthy.';
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

  // Search to see if our review folder already exists
  const existingFolders = await chrome.bookmarks.search({ title: FOLDER_NAME });
  let reviewFolderId = '';

  if (existingFolders.length > 0) {
    reviewFolderId = existingFolders[0].id;
    console.log(`Found existing review folder with ID: ${reviewFolderId}`);
  } else {
    // Create it under the "Other Bookmarks" bar (or root if preferred)
    const newFolder = await chrome.bookmarks.create({
      title: FOLDER_NAME,
      parentId: '2', // '2' is traditionally the default ID for "Other Bookmarks" in Chrome
    });
    reviewFolderId = newFolder.id;
    console.log(`Created new review folder with ID: ${reviewFolderId}`);
  }

  // Move each broken bookmark into the target review folder
  for (const node of failedNodes) {
    try {
      await chrome.bookmarks.move(node.id, { parentId: reviewFolderId });
      console.log(`Moved broken bookmark to review folder: ${node.title}`);
    } catch (moveError) {
      console.error(`Failed to move bookmark ${node.id}:`, moveError);
    }
  }

  console.log(`Successfully migrated ${failedNodes.length} broken links.`);
}
