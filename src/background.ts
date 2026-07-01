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

async function runValidation(folderId: string) {
  isValidationRunning = true;
  currentStatusMessage = 'Fetching bookmarks...';
  console.log(`[INIT] Started validation for folder ID: ${folderId}`);

  try {
    const subTree = await chrome.bookmarks.getSubTree(folderId);
    const bookmarkLinks = subTree[0].children?.filter((node) => node.url) || [];

    if (bookmarkLinks.length === 0) {
      console.log('[INFO] No links found to validate.');
      currentStatusMessage = 'No links found to validate.';
      isValidationRunning = false;
      return;
    }

    const failedBookmarks: chrome.bookmarks.BookmarkTreeNode[] = [];
    const total = bookmarkLinks.length;
    console.log(`[START] Found ${total} total bookmarks to verify.`);

    for (let i = 0; i < total; i++) {
      const link = bookmarkLinks[i];
      if (!link.url) continue;

      const currentItemNumber = i + 1;
      currentStatusMessage = `Checking link ${currentItemNumber} of ${total}...`;

      // 1. CRITICAL LOG: Print right before attempting the fetch
      console.log(
        `[CHECKING] Item ${currentItemNumber}/${total} | Title: "${link.title}" | URL: ${link.url}`
      );

      try {
        // 2. DEFENSIVE FIX: Implement a 5-second network timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(link.url, {
          method: 'HEAD',
          mode: 'no-cors',
          signal: controller.signal, // Attaches the abort control
        });

        clearTimeout(timeoutId); // Clear timeout if network responds quickly

        // 3. LOG SUCCESS: The domain responded
        console.log(
          `[RESPONSE] Item ${currentItemNumber}/${total} returned status: ${response.status}`
        );

        if (response.status >= 400) {
          failedBookmarks.push(link);
        }
      } catch (error: any) {
        // If the error was explicitly thrown by our AbortController timeout
        if (error.name === 'AbortError') {
          console.error(
            `[TIMEOUT ALERT] Item ${currentItemNumber}/${total} took longer than 5 seconds to respond! Skimming past it. URL: ${link.url}`
          );
        } else {
          console.error(
            `[NETWORK ERROR] Item ${currentItemNumber}/${total} failed: ${error.message}`
          );
        }
        failedBookmarks.push(link);
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
  }
  {
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
